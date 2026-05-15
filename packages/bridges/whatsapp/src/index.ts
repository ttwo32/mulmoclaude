#!/usr/bin/env node
// @mulmobridge/whatsapp — WhatsApp bridge for MulmoClaude.
//
// Uses Meta's WhatsApp Cloud API (webhook mode).
//
// Required env vars:
//   WHATSAPP_ACCESS_TOKEN    — permanent access token
//   WHATSAPP_PHONE_NUMBER_ID — phone number ID from Meta dashboard
//   WHATSAPP_VERIFY_TOKEN    — any string for webhook verification
//   WHATSAPP_APP_SECRET      — App secret for x-hub-signature-256 HMAC
//
// Optional:
//   WHATSAPP_BRIDGE_PORT      — webhook port (default: 3003)
//   WHATSAPP_ALLOWED_NUMBERS  — CSV of phone numbers (empty = all)

import "dotenv/config";
import crypto from "crypto";
import express, { type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createBridgeClient } from "@mulmobridge/client";
import { narrowChallenge } from "./verify.js";

const TRANSPORT_ID = "whatsapp";
const PORT = Number(process.env.WHATSAPP_BRIDGE_PORT) || 3003;
const FETCH_TIMEOUT_MS = 30_000;

function readRequiredEnv(): { accessToken: string; phoneNumberId: string; verifyToken: string; appSecret: string } {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!accessToken || !phoneNumberId || !verifyToken || !appSecret) {
    console.error(
      "WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_APP_SECRET are required.\nSee README for setup instructions.",
    );
    process.exit(1);
  }
  return { accessToken, phoneNumberId, verifyToken, appSecret };
}
const { accessToken, phoneNumberId, verifyToken, appSecret } = readRequiredEnv();

const allowedNumbers = new Set(
  (process.env.WHATSAPP_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((phoneNumber) => phoneNumber.trim())
    .filter(Boolean),
);
const allowAll = allowedNumbers.size === 0;

const mulmo = createBridgeClient({ transportId: TRANSPORT_ID });

mulmo.onPush((pushEvent) => {
  sendWhatsAppMessage(pushEvent.chatId, pushEvent.message).catch((err) => console.error(`[whatsapp] push send failed: ${err}`));
});

// ── WhatsApp Cloud API ──────────────────────────────────────────

const API_BASE = `https://graph.facebook.com/v21.0/${phoneNumberId}`;

async function sendWhatsAppMessage(recipientId: string, text: string): Promise<void> {
  const MAX = 4096;
  const chunks =
    text.length === 0
      ? ["(empty reply)"]
      : Array.from({ length: Math.ceil(text.length / MAX) }, (_, chunkIndex) => text.slice(chunkIndex * MAX, (chunkIndex + 1) * MAX));

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipientId,
          type: "text",
          text: { body: chunk },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[whatsapp] sendMessage failed: ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[whatsapp] sendMessage error: ${err}`);
    }
  }
}

// ── Signature verification (x-hub-signature-256) ────────────────

function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.replace("sha256=", "");
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// ── Payload extraction ──────────────────────────────────────────

interface WhatsAppTextMessage {
  from: string;
  text: { body: string };
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOneMessage(msg: unknown): WhatsAppTextMessage | null {
  if (!isObj(msg)) return null;
  if (msg.type !== "text" || typeof msg.from !== "string") return null;
  if (!isObj(msg.text)) return null;
  const { body } = msg.text;
  if (typeof body !== "string" || !body.trim()) return null;
  return { from: msg.from, text: { body } };
}

function collectRawMessages(body: unknown): unknown[] {
  if (!isObj(body) || !Array.isArray(body.entry)) return [];
  const raw: unknown[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const { messages } = change.value;
      if (Array.isArray(messages)) raw.push(...messages);
    }
  }
  return raw;
}

function extractTextMessages(body: unknown): WhatsAppTextMessage[] {
  return collectRawMessages(body)
    .map(parseOneMessage)
    .filter((message): message is WhatsAppTextMessage => message !== null);
}

// ── Webhook server ──────────────────────────────────────────────

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

// Parse as raw text so we can verify the HMAC before JSON parsing
app.use(express.text({ type: "application/json" }));

// Per-IP throttle on the webhook endpoint. CodeQL's
// `js/missing-rate-limiting` rule recognises `express-rate-limit`
// specifically, and Meta's platform sends well under 120 req/min/IP
// during normal use, so the cap exists to bound a flood / stuck
// retry loop. The verification GET shares the limiter since a
// flood of bogus `hub.challenge` probes would otherwise hammer
// us just as effectively.
const webhookRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Explicit keyGenerator routed through `ipKeyGenerator(...)`. The
  // raw `req.ip` reading isn't safe on its own — IPv6 clients can
  // rotate addresses within a /56 prefix and evade per-client limits.
  // `express-rate-limit`'s `ipKeyGenerator` normalises both IPv4
  // and IPv6 (folding IPv6 to its /56 subnet by default), which is
  // what `req.ip` alone misses. The `app.set("trust proxy", ...)`
  // block above is what makes `req.ip` reflect the real client
  // rather than the LB. Together: explicit + IPv6-safe + proxy-
  // aware (Codex reviews iter-1 + iter-2 on #1326).
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "", 56),
});

// Webhook verification (GET).
//
// Meta sends `hub.mode=subscribe` + the shared `hub.verify_token`
// + a one-time `hub.challenge` ASCII nonce that we must echo back.
// Three layered defences against `js/reflected-xss` — full
// rationale + compatibility notes live in `./verify.ts` next to
// the unit-tested `narrowChallenge` helper.
//
//   1. **Shape whitelist** on `hub.challenge` (`narrowChallenge`)
//      — required to clear CodeQL's data-flow analyser (we tried
//      `text/plain` alone and the alert stayed open).
//   2. **`text/plain` content-type** — neutralises browser HTML
//      execution even if a future regression widened the whitelist.
//   3. **String-narrowing** — `narrowChallenge` rejects non-string
//      query values so `?hub.challenge[]=…` array forms can't
//      bypass the regex via toString().
app.get("/webhook", webhookRateLimit, (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = narrowChallenge(req.query["hub.challenge"]);

  if (mode === "subscribe" && token === verifyToken && challenge !== null) {
    console.log("[whatsapp] webhook verified");
    res.type("text/plain").status(200).send(challenge);
  } else {
    res.status(403).type("text/plain").send("Forbidden");
  }
});

// Webhook events (POST) — signature-verified + rate-limited
app.post("/webhook", webhookRateLimit, async (req: Request, res: Response) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  const rawBody = req.body as string;

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    console.warn("[whatsapp] webhook signature verification failed");
    res.status(401).send("Invalid signature");
    return;
  }

  res.status(200).send("OK");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    console.error("[whatsapp] malformed JSON in webhook body");
    return;
  }

  for (const msg of extractTextMessages(parsed)) {
    if (!allowAll && !allowedNumbers.has(msg.from)) {
      console.log(`[whatsapp] denied from=${msg.from}`);
      continue;
    }

    console.log(`[whatsapp] message from=${msg.from} len=${msg.text.body.length}`);

    try {
      const ack = await mulmo.send(msg.from, msg.text.body);
      if (ack.ok) {
        await sendWhatsAppMessage(msg.from, ack.reply ?? "");
      } else {
        const status = ack.status ? ` (${ack.status})` : "";
        await sendWhatsAppMessage(msg.from, `Error${status}: ${ack.error ?? "unknown"}`);
      }
    } catch (err) {
      console.error(`[whatsapp] message handling failed: ${err}`);
    }
  }
});

app.listen(PORT, () => {
  console.log("MulmoClaude WhatsApp bridge");
  console.log(`Webhook listening on http://localhost:${PORT}/webhook`);
});
