/**
 * One-shot probe of the clearpath/resy-booker MCP server.
 *
 * What it does:
 *   1. Connects to the Apify Standby MCP endpoint
 *   2. Lists tools
 *   3. Calls `login` with your Resy credentials
 *   4. Calls `search_restaurants` (cheap, $0.03)
 *   5. Calls `my_reservations` (free)
 *
 * What it does NOT do:
 *   - Call `book_reservation` (that costs $3.99)
 *   - Call `cancel_reservation` (destructive)
 *
 * Output: JSON files in docs/apify-samples/ so Claude can align TypeScript
 * types to the actor's real output shapes.
 *
 * Usage (from repo root):
 *   pnpm probe <resy-email> <resy-password>
 *
 * Requires APIFY_API_TOKEN — reads from env or from apps/web/.env.local.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://clearpath--resy-booker.apify.actor/mcp";
const OUT_DIR = join(process.cwd(), "docs/apify-samples");

function loadApifyToken(): string | null {
  if (process.env.APIFY_API_TOKEN) return process.env.APIFY_API_TOKEN;

  const envPath = join(process.cwd(), "apps/web/.env.local");
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, "utf8").match(/^APIFY_API_TOKEN=(.*)$/m);
  const raw = match?.[1]?.trim();
  if (!raw || raw === "placeholder") return null;
  // strip surrounding quotes if the user added them
  return raw.replace(/^["']|["']$/g, "");
}

function writeSample(filename: string, data: unknown) {
  const path = join(OUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  → wrote ${path}`);
}

/**
 * Unwrap a tool call result and classify it. This actor returns logical errors
 * inside the payload (with isError === false at the MCP level), so we have to
 * look at structuredContent to tell success from failure.
 */
function classifyResult(res: {
  isError?: boolean;
  structuredContent?: unknown;
}): { ok: boolean; error?: string } {
  if (res.isError) return { ok: false, error: "MCP transport error" };
  const sc = res.structuredContent as Record<string, unknown> | undefined;
  if (!sc) return { ok: true };

  // Shape 1: { success: false, error: "..." }  (login)
  if (sc.success === false) {
    return { ok: false, error: String(sc.error ?? "unknown error") };
  }
  // Shape 2: { result: [{ error: "..." }] }  (search, my_reservations)
  if (Array.isArray(sc.result) && sc.result.length > 0) {
    const first = sc.result[0] as Record<string, unknown>;
    if (first && "error" in first && Object.keys(first).length === 1) {
      return { ok: false, error: String(first.error) };
    }
  }
  return { ok: true };
}

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error(
      "Usage: pnpm probe <resy-email> <resy-password>\n" +
        "  (run from the repo root; the password is never stored on disk)",
    );
    process.exit(1);
  }

  // Sanity-check the inputs (without echoing the password)
  console.log(`Email:           ${email}`);
  console.log(`Password length: ${password.length} character(s)`);
  if (password.startsWith("<") && password.endsWith(">")) {
    console.error(
      "\n⚠ The password looks like a placeholder (starts with < and ends with >).\n" +
        "  Did you mean to substitute your real password? Stopping.",
    );
    process.exit(1);
  }

  const token = loadApifyToken();
  if (!token) {
    console.error(
      "APIFY_API_TOKEN is not set. Either:\n" +
        "  1. Put it in apps/web/.env.local (replace the placeholder), or\n" +
        "  2. Export it:  export APIFY_API_TOKEN=apify_api_...",
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Connecting to ${MCP_URL} …`);
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "yeyak-probe", version: "0.1.0" });
  await client.connect(transport);
  console.log("✓ connected");

  console.log("\nListing tools …");
  const tools = await client.listTools();
  writeSample("tools.json", tools);
  console.log(`✓ ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  console.log("\nCalling login …");
  const loginRes = await client.callTool({
    name: "login",
    arguments: { email, password },
  });
  writeSample("login.json", loginRes);
  const loginStatus = classifyResult(loginRes);
  if (!loginStatus.ok) {
    console.error(`✗ login failed: ${loginStatus.error}`);
    console.error(
      "\nVerify the password works by signing in at https://resy.com.\n" +
        "If it works in the browser but fails here, Resy may have a short\n" +
        "soft-block on this account — wait ~15 min and try again.",
    );
    await client.close();
    process.exit(1);
  }
  console.log("✓ login ok");

  console.log("\nCalling search_restaurants (New York, party of 2) …");
  const searchRes = await client.callTool({
    name: "search_restaurants",
    arguments: { city: "New York", party_size: 2, limit: 5 },
  });
  writeSample("search.json", searchRes);
  const searchStatus = classifyResult(searchRes);
  if (!searchStatus.ok) {
    console.error(`✗ search failed: ${searchStatus.error}`);
  } else {
    console.log("✓ search ok");
  }

  console.log("\nCalling my_reservations …");
  const resvRes = await client.callTool({
    name: "my_reservations",
    arguments: {},
  });
  writeSample("my_reservations.json", resvRes);
  const resvStatus = classifyResult(resvRes);
  if (!resvStatus.ok) {
    console.error(`✗ my_reservations failed: ${resvStatus.error}`);
  } else {
    console.log("✓ my_reservations ok");
  }

  // Use one venue from the search to probe check_availability ($0.05).
  // Falls back to a known URL if the search happened to return nothing.
  const sc = searchRes.structuredContent as { result?: Array<{ url?: string }> } | undefined;
  const probeUrl = sc?.result?.[0]?.url ?? "https://resy.com/cities/new-york-ny/le-gratin";
  console.log(`\nCalling check_availability (${probeUrl}) …`);
  const checkRes = await client.callTool({
    name: "check_availability",
    arguments: { restaurant_url: probeUrl, party_size: 2 },
  });
  writeSample("check_availability.json", checkRes);
  const checkStatus = classifyResult(checkRes);
  if (!checkStatus.ok) {
    console.error(`✗ check_availability failed: ${checkStatus.error}`);
  } else {
    console.log("✓ check_availability ok");
  }

  await client.close();
  console.log(
    "\n✓ All done. Share the contents of docs/apify-samples/ with Claude — " +
      "that folder is the source of truth for the real actor output.",
  );
}

main().catch((err) => {
  console.error("\n✗ Probe failed:");
  console.error(err);
  process.exit(1);
});
