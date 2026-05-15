/**
 * Worker-side notifications — minimal duplication of the web module to
 * keep the worker self-contained.
 */
import { Resend } from "resend";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[worker/notify] Resend not configured, skipping email to", params.to);
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, ...params });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export async function sendSms(params: { to: string; body: string }): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.warn("[worker/notify] Twilio not configured, skipping SMS to", params.to);
    return;
  }
  const twilioMod = await import("twilio");
  const client = twilioMod.default(sid, token);
  await client.messages.create({ from, to: params.to, body: params.body });
}
