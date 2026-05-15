/**
 * Outbound notifications — email (Resend) and SMS (Twilio).
 *
 * Both clients are optional; if the relevant env vars aren't set we simply
 * skip sending and log a warning. That keeps local dev lightweight.
 */
import { Resend } from "resend";

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: EmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn("[notifications] Resend not configured, skipping email to", input.to);
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, ...input });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export interface SmsInput {
  to: string;
  body: string;
}

export async function sendSms(input: SmsInput): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.warn("[notifications] Twilio not configured, skipping SMS to", input.to);
    return;
  }
  // Lazy-load to avoid bundling twilio in edge routes that don't need it
  const twilioMod = await import("twilio");
  const client = twilioMod.default(sid, token);
  await client.messages.create({ from, to: input.to, body: input.body });
}

/**
 * Convenience: notify a user about a booking outcome across their enabled
 * channels. Safe to call even if neither email nor sms is configured.
 */
export interface BookingNotification {
  email: string;
  emailEnabled: boolean;
  phone: string | null;
  smsEnabled: boolean;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
}

export async function notifyBooking(n: BookingNotification): Promise<void> {
  const summary = `${n.restaurantName} · ${n.date} at ${n.time.slice(0, 5)} for ${n.partySize}`;
  const tasks: Promise<unknown>[] = [];
  if (n.emailEnabled && n.email) {
    tasks.push(
      sendEmail({
        to: n.email,
        subject: `Your table at ${n.restaurantName} is confirmed`,
        html: `<p>Your reservation is confirmed.</p><p><strong>${summary}</strong></p>`,
      }),
    );
  }
  if (n.smsEnabled && n.phone) {
    tasks.push(sendSms({ to: n.phone, body: `Yeyak: Confirmed — ${summary}.` }));
  }
  await Promise.allSettled(tasks);
}
