#!/usr/bin/env node
// @mulmobridge/messenger — Facebook Messenger bridge for MulmoClaude.
//
// Uses the Meta Send/Receive API (webhook mode, same infra as WhatsApp).
//
// Required env vars:
//   MESSENGER_PAGE_ACCESS_TOKEN — Page access token
//   MESSENGER_VERIFY_TOKEN      — Arbitrary string for webhook verification
//   MESSENGER_APP_SECRET        — App secret for x-hub-signature-256 HMAC
//
// Optional:
//   MESSENGER_BRIDGE_PORT — Webhook port (default: 3004)

import "dotenv/config";
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createBridgeClient, chunkText } from "@mulmobridge/client";
import { narrowChallenge } from "./verify.js";

const TRANSPORT_ID = "messenger";
const PORT = Number(process.env.MESSENGER_BRIDGE_PORT) || 3004;

function readRequiredEnv(): { pageAccessToken: string; verifyToken: string; appSecret: string } {
  const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
  const appSecret = process.env.MESSENGER_APP_SECRET;
  if (!pageAccessToken || !verifyToken || !appSecret) {
    console.error("MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_VERIFY_TOKEN, and MESSENGER_APP_SECRET are required.\nSee README for setup instructions.");
    process.exit(1);
  }
  return { pageAccessToken, verifyToken, appSecret };
}
const { pageAccessToken, verifyToken, appSecret } = readRequiredEnv();

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendTextMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[messenger] push send failed: ${err}`));
});

// ── Messenger Send API ──────────────────────────────────────────

async function sendTextMessage(recipientId: string, text: string): Promise<void> {
  const MAX = 2000; // Messenger's message limit
  const chunks = chunkText(text, MAX);

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${pageAccessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: chunk },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[messenger] send failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[messenger] send error: ${err}`);
    }
  }
}

// ── Signature verification ──────────────────────────────────────

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.replace("sha256=", "");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// ── Webhook server ──────────────────────────────────────────────

const BODY_LIMIT = "1mb";

// `express-rate-limit` is the well-tested per-IP throttle that
// CodeQL's `js/missing-rate-limiting` rule recognises. Defaults
// match the conservative 120 req/min/IP cap the bridge has shipped
// since the original custom Map-based limiter was added — Meta's
// platform sends well under this rate during normal use, so the
// cap exists to bound a flood / accidentally-stuck retry loop.
const webhookRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  // Send the limit + remaining count in standard `RateLimit-*`
  // headers so the upstream platform can self-throttle.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Explicit keyGenerator routed through `ipKeyGenerator(...)` so
  // IPv6 clients get folded to their /56 subnet (a raw `req.ip` key
  // would let IPv6 rotation within a prefix evade the per-client
  // limit). `req.ip` itself is trust-proxy-aware via the
  // `app.set("trust proxy", ...)` block below. (Codex reviews
  // iter-1 + iter-2 on #1326.)
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "", 56),
});

const app = express();
app.disable("x-powered-by");

// Honour an explicit `trust proxy` setting so `req.ip` (the
// rate-limit key below) reflects the real client IP rather than
// the load balancer's. Default `false` for safety; operators
// behind a known LB choose from:
//   - hop count:  BRIDGE_TRUST_PROXY=1
//   - boolean:    BRIDGE_TRUST_PROXY=true / false
//   - preset:     BRIDGE_TRUST_PROXY=loopback
//   - CIDR list:  BRIDGE_TRUST_PROXY=10.0.0.0/8,192.168.0.0/16
// Without this every webhook looks like it comes from one IP and
// the limiter degrades into a global throttle. The boolean branch
// is required because Express does NOT auto-convert string
// "true"/"false" — without this, `BRIDGE_TRUST_PROXY=true` is read
// as a (never-matching) CIDR rule (Codex reviews on #1326).
const trustProxyEnv = process.env.BRIDGE_TRUST_PROXY;
if (trustProxyEnv) {
  const lower = trustProxyEnv.toLowerCase();
  const numeric = Number(trustProxyEnv);
  const value: boolean | number | string =
    lower === "true" ? true : lower === "false" ? false : Number.isInteger(numeric) && numeric >= 0 ? numeric : trustProxyEnv;
  app.set("trust proxy", value);
}

app.use(express.text({ type: "application/json", limit: BODY_LIMIT }));

// Webhook verification (GET). Rate-limited so a flood of bogus
// `hub.challenge` probes can't hammer the bridge before the
// `hub.verify_token` check rejects them. Matches the WhatsApp
// bridge's GET-side throttling — same shared Meta protocol, same
// abuse surface (Codex review on #1326). The `narrowChallenge`
// helper from `./verify.ts` enforces the `js/reflected-xss`
// shape whitelist; see that file for the full rationale.
app.get("/webhook", webhookRateLimit, (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = narrowChallenge(req.query["hub.challenge"]);
  if (mode === "subscribe" && token === verifyToken && challenge !== null) {
    console.log("[messenger] webhook verified");
    res.type("text/plain").status(200).send(challenge);
  } else {
    res.status(403).type("text/plain").send("Forbidden");
  }
});

async function handleWebhookBody(rawBody: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[messenger] malformed JSON");
    return;
  }
  for (const msg of extractMessages(parsed)) {
    await processOneMessage(msg);
  }
}

// Webhook events (POST). Rate-limited per-IP via `webhookRateLimit`
// above; the middleware writes the 429 response itself when the cap
// is hit so the handler body only sees admitted requests.
app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = typeof req.headers["x-hub-signature-256"] === "string" ? req.headers["x-hub-signature-256"] : "";
  const rawBody = typeof req.body === "string" ? req.body : "";

  if (!signature || !verifySignature(rawBody, signature)) {
    console.warn("[messenger] AUTH_FAILED: signature verification failed");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("EVENT_RECEIVED");
  await handleWebhookBody(rawBody);
});

function redactId(resourceId: string): string {
  return resourceId.length > 6 ? `${resourceId.slice(0, 3)}***${resourceId.slice(-3)}` : "***";
}

async function processOneMessage(msg: ExtractedMessage): Promise<void> {
  console.log(`[messenger] message from=${redactId(msg.senderId)} len=${msg.text.length}`);
  try {
    const ack = await mulmo.send(msg.senderId, msg.text);
    if (ack.ok) {
      await sendTextMessage(msg.senderId, ack.reply ?? "");
    } else {
      const status = ack.status ? ` (${ack.status})` : "";
      await sendTextMessage(msg.senderId, `Error${status}: ${ack.error ?? "unknown"}`);
    }
  } catch (err) {
    console.error(`[messenger] message handling failed: ${err}`);
  }
}

// ── Payload extraction ──────────────────────────────────────────

interface ExtractedMessage {
  senderId: string;
  text: string;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOneEvent(event: unknown): ExtractedMessage | null {
  if (!isObj(event)) return null;
  if (!isObj(event.sender) || typeof event.sender.id !== "string") return null;
  if (!isObj(event.message) || typeof event.message.text !== "string") return null;
  const text = event.message.text.trim();
  if (!text) return null;
  return { senderId: event.sender.id, text };
}

function extractMessages(body: unknown): ExtractedMessage[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const out: ExtractedMessage[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const msg = parseOneEvent(event);
      if (msg) out.push(msg);
    }
  }
  return out;
}

// ── Start ───────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("MulmoClaude Messenger bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
