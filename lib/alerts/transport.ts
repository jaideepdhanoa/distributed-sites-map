import nodemailer from "nodemailer";
import alertDefaults from "../../config/alerts.json";

export const DEFAULT_FROM = alertDefaults.from;

export type OutboundMail = {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
};

export interface MailTransport {
  readonly kind: "resend" | "smtp";
  send(mail: OutboundMail): Promise<void>;
}

export function transportKind(): "resend" | "smtp" | null {
  if (process.env.RESEND_API_KEY?.trim()) return "resend";
  if (process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) return "smtp";
  return null;
}

/** Resend uses the verified from-address. Gmail falls back to the SMTP mailbox when ALERT_FROM is unset. */
export function alertFrom(): string {
  const configured = process.env.ALERT_FROM?.trim();
  if (configured) return configured;
  if (transportKind() === "smtp") return process.env.SMTP_USER?.trim() || DEFAULT_FROM;
  return DEFAULT_FROM;
}

export function alertReplyTo(): string {
  return process.env.ALERT_REPLY_TO?.trim() || alertDefaults.replyTo;
}

async function sendResend(mail: OutboundMail): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("Resend is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
  });
  if (!response.ok) throw new Error("Resend rejected the message.");
}

export function mailTransport(): MailTransport | null {
  const kind = transportKind();
  if (kind === "resend") {
    return { kind, send: sendResend };
  }
  if (kind !== "smtp") return null;
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return {
    kind,
    async send(mail) {
      await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
      });
    },
  };
}
