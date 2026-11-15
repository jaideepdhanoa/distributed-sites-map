import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { MAIL_SEND_TIMEOUT_MS, mailTransport, runMailSend } from "../../lib/alerts/transport";

const sample = {
  to: "jaideep@dhanoa.in",
  from: "Distributed Sites <alerts@distributedsites.com>",
  replyTo: "jaideep@dhanoa.in",
  subject: "Hello",
  text: "Hello",
};

test("the mail send stops when the abort signal fires", async () => {
  await assert.rejects(
    () => runMailSend((signal) => new Promise((_resolve, reject) => {
      const timer = setInterval(() => {}, 1_000);
      signal.addEventListener("abort", () => {
        clearInterval(timer);
        reject(new Error("aborted"));
      }, { once: true });
    }), 20),
    /timed out/,
  );
  assert.equal(MAIL_SEND_TIMEOUT_MS, 60_000);
});

test("Resend passes a one-minute abort signal to fetch", async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    timeout: AbortSignal.timeout,
    fetch: globalThis.fetch,
  };
  let requested = 0;
  AbortSignal.timeout = ((ms: number) => {
    requested = ms;
    return previous.timeout.call(AbortSignal, 20);
  }) as typeof AbortSignal.timeout;
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal | null }) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("missing signal"));
      return;
    }
    const timer = setInterval(() => {}, 1_000);
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  })) as typeof fetch;
  try {
    const transport = mailTransport();
    assert.equal(transport?.kind, "resend");
    await assert.rejects(() => transport!.send(sample), /timed out/);
    assert.equal(requested, MAIL_SEND_TIMEOUT_MS);
  } finally {
    AbortSignal.timeout = previous.timeout;
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.user === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.user;
    if (previous.pass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previous.pass;
  }
});

test("SMTP send aborts on the same mail timeout", async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    timeout: AbortSignal.timeout,
    create: nodemailer.createTransport,
  };
  let requested = 0;
  let closed = false;
  AbortSignal.timeout = ((ms: number) => {
    requested = ms;
    return previous.timeout.call(AbortSignal, 20);
  }) as typeof AbortSignal.timeout;
  nodemailer.createTransport = (() => ({
    close() {
      closed = true;
    },
    sendMail() {
      return new Promise((_resolve, reject) => {
        const timer = setInterval(() => {
          if (!closed) return;
          clearInterval(timer);
          reject(new Error("closed"));
        }, 5);
      });
    },
  })) as typeof nodemailer.createTransport;
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  try {
    const transport = mailTransport();
    assert.equal(transport?.kind, "smtp");
    await assert.rejects(() => transport!.send(sample), /timed out/);
    assert.equal(closed, true);
    assert.equal(requested, MAIL_SEND_TIMEOUT_MS);
  } finally {
    AbortSignal.timeout = previous.timeout;
    nodemailer.createTransport = previous.create;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.key;
    if (previous.user === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = previous.user;
    if (previous.pass === undefined) delete process.env.SMTP_PASS;
    else process.env.SMTP_PASS = previous.pass;
  }
});
