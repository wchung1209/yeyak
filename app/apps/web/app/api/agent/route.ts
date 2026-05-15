/**
 * Streaming Claude agent route.
 *
 * Request body:  { messages: Anthropic.MessageParam[], sessionId: string }
 * Response:      text/event-stream. Each event is a JSON line:
 *    { type: "text", text: "..." }
 *    { type: "tool_use", name, input }
 *    { type: "tool_result", name, output }
 *    { type: "done" }
 *
 * Lifecycle:
 *   1. Auth + load Resy creds.
 *   2. Open one MCP session for the whole turn (logged in if creds exist).
 *   3. Run Claude in a multi-turn loop until it stops calling tools.
 *   4. Close the MCP session in `finally`.
 *
 * The MCP connection is shared across all tool calls in a single chat
 * turn — opening a fresh authenticated session per tool would multiply
 * latency and re-trigger Resy's login throttling.
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { withResySession, ResyMcpError, fetchResyCredentials } from "@yeyak/resy";
import { AGENT_TOOLS, executeTool, type ToolContext } from "@/lib/agent/tools";
import {
  buildSystemPrompt,
  computeDateContext,
  type UserDefaults,
} from "@/lib/agent/prompts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 8;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as {
    messages: Anthropic.MessageParam[];
    sessionId: string;
  };

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const svc = createSupabaseServiceClient();
  const credentials = await fetchResyCredentials(svc, user.id);
  const promptCtx = await loadPromptContext(svc, user.id);
  const systemPrompt = buildSystemPrompt({
    ...promptCtx,
    hasResyCredentials: credentials !== null,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        await withResySession(
          {
            apifyToken: env.APIFY_API_TOKEN,
            supabase: svc,
            source: "agent",
            sessionId: body.sessionId,
            userId: user.id,
          },
          credentials,
          async (resy) => {
            const ctx: ToolContext = {
              userId: user.id,
              supabase: svc,
              resy,
              resyAuthenticated: credentials !== null,
              sessionId: body.sessionId,
            };
            await runAgentLoop({ anthropic, body, ctx, send, systemPrompt });
          },
        );
      } catch (err) {
        const message =
          err instanceof ResyMcpError
            ? `Resy: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/**
 * Load the per-request prompt context: today's date in the user's
 * timezone plus their saved defaults from `profiles`. Falls back to
 * America/New_York and no defaults if the profile read fails — the
 * agent stays usable, just without personalization.
 */
async function loadPromptContext(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "timezone, default_city, default_party_size, default_dinner_start, default_dinner_end, default_lunch_start, default_lunch_end",
    )
    .eq("id", userId)
    .single();

  if (error || !data) {
    return computeDateContext();
  }

  const trim = (t: string | null | undefined) =>
    t ? String(t).slice(0, 5) : null;
  const defaults: UserDefaults = {
    city: data.default_city,
    partySize: data.default_party_size,
    dinnerStart: trim(data.default_dinner_start),
    dinnerEnd: trim(data.default_dinner_end),
    lunchStart: trim(data.default_lunch_start),
    lunchEnd: trim(data.default_lunch_end),
  };

  return {
    ...computeDateContext(data.timezone ?? undefined),
    defaults,
  };
}

async function runAgentLoop({
  anthropic,
  body,
  ctx,
  send,
  systemPrompt,
}: {
  anthropic: Anthropic;
  body: { messages: Anthropic.MessageParam[]; sessionId: string };
  ctx: ToolContext;
  send: (event: unknown) => void;
  systemPrompt: string;
}): Promise<void> {
  let messages = [...body.messages];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    for (const block of response.content) {
      if (block.type === "text") {
        send({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        send({ type: "tool_use", name: block.name, input: block.input });
      }
    }

    if (response.stop_reason !== "tool_use") {
      // Capture the final assistant turn before emitting so the client's
      // transcript reflects everything the model just said.
      messages = [
        ...messages,
        { role: "assistant", content: response.content },
      ];
      send({ type: "final_messages", messages });
      send({ type: "done" });
      return;
    }

    // Execute every tool_use block in parallel, then send results back.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results = await Promise.all(
      toolUses.map(async (t) => {
        try {
          const output = await executeTool(t.name, t.input, ctx);
          send({ type: "tool_result", name: t.name, output });
          return {
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: JSON.stringify(output),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          send({ type: "tool_result", name: t.name, output: { error: message } });
          return {
            type: "tool_result" as const,
            tool_use_id: t.id,
            content: JSON.stringify({ error: message }),
            is_error: true,
          };
        }
      }),
    );

    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: results },
    ];
  }

  // Hit MAX_TURNS without a non-tool stop. Surface what we have so the
  // client at least preserves the partial transcript.
  send({ type: "final_messages", messages });
  send({ type: "done" });
}

async function currentUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
