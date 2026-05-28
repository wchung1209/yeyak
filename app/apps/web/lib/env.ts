/**
 * Typed environment access. Throws at import time if required vars are
 * missing in a server context — preventing silent misconfigurations.
 */
import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  APIFY_API_TOKEN: z.string().min(1),
  APIFY_RESY_ACTOR_ID: z.string().default("clearpath/resy-booker"),
  // Resend onboarding (task #45) is deferred; keep these optional so the
  // build doesn't fail on Vercel until we wire real keys. When wiring
  // Resend later, decide whether to tighten back to required.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

const isServer = typeof window === "undefined";
const raw = isServer ? process.env : {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

const parsed = isServer ? serverSchema.safeParse(raw) : publicSchema.safeParse(raw);

if (!parsed.success) {
  // Fail loudly in dev; log but don't throw in prod browser bundles
  if (isServer) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Environment variables are missing or invalid. See .env.example.");
  }
}

export const env = (parsed.success ? parsed.data : {}) as z.infer<typeof serverSchema>;
