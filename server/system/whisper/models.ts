// Whisper GGML model registry + on-disk management for local voice
// input. Weights live under `{workspace}/models/` (a top-level dir,
// NOT under git-managed `data/` — see server/workspace/paths.ts) and
// are downloaded on demand when the user enables voice input in
// Settings. See plans/feat-voice-input.md.

import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from "fs";
import { once } from "events";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { errorMessage } from "../../utils/errors.js";
import { ONE_MINUTE_MS } from "../../utils/time.js";
import { log } from "../logger/index.js";

// Abort a download if no bytes arrive for this long (stalled connection).
const DOWNLOAD_STALL_TIMEOUT_MS = ONE_MINUTE_MS;

export interface WhisperModelSpec {
  /** GGML filename — identical on disk and in the Hugging Face repo. */
  readonly file: string;
  /** Download URL (Hugging Face whisper.cpp model repo). */
  readonly url: string;
  /** Conservative lower bound on the finished file size, in bytes. A
   *  completed download must be at least this big — guards against a
   *  truncated transfer or an HTML error page saved as the model
   *  without pinning an exact checksum. The Phase 0 spike can tighten
   *  this to a sha256 verification. */
  readonly minBytes: number;
}

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

// Default is large-v3-turbo (strong Japanese accuracy, near-real-time
// on Apple Silicon with Metal). small/base are lighter fallbacks for
// low-RAM machines, exposed in the Settings model picker.
export const WHISPER_MODELS = {
  "large-v3-turbo": { file: "ggml-large-v3-turbo.bin", url: `${HF_BASE}/ggml-large-v3-turbo.bin`, minBytes: 1_000_000_000 },
  small: { file: "ggml-small.bin", url: `${HF_BASE}/ggml-small.bin`, minBytes: 300_000_000 },
  base: { file: "ggml-base.bin", url: `${HF_BASE}/ggml-base.bin`, minBytes: 100_000_000 },
} as const satisfies Record<string, WhisperModelSpec>;

export type WhisperModelName = keyof typeof WHISPER_MODELS;
export const DEFAULT_WHISPER_MODEL: WhisperModelName = "large-v3-turbo";

export function isWhisperModelName(value: unknown): value is WhisperModelName {
  return typeof value === "string" && value in WHISPER_MODELS;
}

/** Resolve a possibly-unset / unknown model name to a valid one,
 *  falling back to the default. */
export function resolveModelName(name: string | undefined): WhisperModelName {
  return isWhisperModelName(name) ? name : DEFAULT_WHISPER_MODEL;
}

export function modelFilePath(name: WhisperModelName): string {
  return path.join(WORKSPACE_PATHS.models, WHISPER_MODELS[name].file);
}

/** A model is "ready" when its file exists and meets the size floor. */
export function isModelReady(name: WhisperModelName): boolean {
  try {
    return statSync(modelFilePath(name)).size >= WHISPER_MODELS[name].minBytes;
  } catch {
    return false;
  }
}

export type ModelDownloadState = "idle" | "downloading" | "ready" | "error";

export interface ModelStatus {
  state: ModelDownloadState;
  /** 0..1 — present only while downloading and Content-Length is known. */
  progress?: number;
  /** Present only in the "error" state. */
  error?: string;
}

// In-flight download status per model. A finished file on disk is the
// source of truth for "ready"; this map tracks transient progress and
// the last error so the Settings UI / health endpoint can report them.
const downloadStatus = new Map<WhisperModelName, ModelStatus>();

export function getModelStatus(name: WhisperModelName): ModelStatus {
  const live = downloadStatus.get(name);
  if (live?.state === "downloading") return live;
  if (isModelReady(name)) return { state: "ready" };
  return live ?? { state: "idle" };
}

async function streamToFile(
  body: ReadableStream<Uint8Array>,
  partialPath: string,
  total: number,
  name: WhisperModelName,
  onProgress: () => void,
): Promise<void> {
  const reader = body.getReader();
  const fileStream = createWriteStream(partialPath);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onProgress();
      received += value.byteLength;
      if (!fileStream.write(value)) await once(fileStream, "drain");
      if (total > 0) downloadStatus.set(name, { state: "downloading", progress: received / total });
    }
    fileStream.end();
    await once(fileStream, "finish");
  } catch (err) {
    fileStream.destroy();
    throw err;
  }
}

async function downloadModel(name: WhisperModelName): Promise<void> {
  const spec = WHISPER_MODELS[name];
  mkdirSync(WORKSPACE_PATHS.models, { recursive: true });
  const dest = modelFilePath(name);
  const partial = `${dest}.partial`;
  // Abort on a stalled connection (no bytes for STALL_TIMEOUT) without
  // capping the total time — a 1–3 GB download is legitimately slow. The
  // watchdog is reset on every chunk; an abort surfaces as the error state.
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_TIMEOUT_MS);
  };
  try {
    const response = await fetch(spec.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    resetStall();
    await streamToFile(response.body, partial, total, name, resetStall);
    if (statSync(partial).size < spec.minBytes) {
      unlinkSync(partial);
      throw new Error("downloaded file is smaller than expected — likely truncated");
    }
    renameSync(partial, dest);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/** Kick off (or no-op) a model download. Fire-and-forget: errors are
 *  captured into the status map rather than thrown, so callers (the
 *  enable toggle's route) return immediately and the UI polls
 *  `getModelStatus` for progress. Idempotent — a second call while a
 *  download is in flight does nothing. */
export async function ensureModelDownloaded(name: WhisperModelName): Promise<void> {
  if (isModelReady(name)) {
    downloadStatus.set(name, { state: "ready" });
    return;
  }
  if (downloadStatus.get(name)?.state === "downloading") return;
  downloadStatus.set(name, { state: "downloading", progress: 0 });
  log.info("whisper", "model download: start", { model: name });
  try {
    await downloadModel(name);
    downloadStatus.set(name, { state: "ready" });
    log.info("whisper", "model download: ok", { model: name });
  } catch (err) {
    const error = errorMessage(err);
    downloadStatus.set(name, { state: "error", error });
    log.error("whisper", "model download: failed", { model: name, error });
  }
}
