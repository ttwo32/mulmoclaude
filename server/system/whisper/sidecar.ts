// whisper.cpp warm-model sidecar. Rather than reload the GGML weights
// on every request (a one-shot `whisper-cli` per clip), we spawn
// `whisper-server` once with the model preloaded and reuse it across
// transcriptions over its local HTTP API. This is the §3/§9 decision in
// plans/feat-voice-input.md: process isolation (no native addon / ABI
// risk) AND a warm model (weights stay resident).

import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { readFile } from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../utils/time.js";
import { log } from "../logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { modelFilePath, type WhisperModelName } from "./models.js";

const HOST = "127.0.0.1";
// Large models load slowly the first time; poll generously before
// giving up on a freshly-spawned server.
const READY_TIMEOUT_MS = 60 * ONE_SECOND_MS;
const READY_POLL_INTERVAL_MS = 500;
// A single clip is ≤60s and the model is warm, so inference is quick;
// this cap just stops a hung /inference from blocking the request box.
const INFERENCE_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

interface Sidecar {
  readonly port: number;
  readonly proc: ChildProcess;
  readonly model: WhisperModelName;
}

let sidecar: Sidecar | null = null;
// Tracks the in-flight start AND the model it's for, so a request for a
// different model never reuses a startup spawned for the wrong one.
let starting: { model: WhisperModelName; promise: Promise<Sidecar> } | null = null;

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free port")));
      }
    });
  });
}

/** Resolve once the server answers any HTTP request, or throw after the
 *  ready timeout. Any HTTP status (even 404) means the listener is up. */
async function waitUntilReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(ONE_SECOND_MS) });
      return;
    } catch {
      await delay(READY_POLL_INTERVAL_MS);
    }
  }
  throw new Error("whisper-server did not become ready in time");
}

// whisper-server logs verbosely to stderr (model info on startup, timing
// per inference). We MUST drain that pipe — left unread, the OS pipe
// buffer (~64KB) fills and the child blocks on its next stderr write,
// hanging the in-flight transcription. We consume it into a small tail
// buffer so a failed start/exit still has diagnostics, without ever
// letting the pipe back up.
function drainStderr(proc: ChildProcess, tail: { text: string }): void {
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    tail.text = (tail.text + chunk).slice(-4000);
  });
}

// Resolve when the server answers, or reject if the process fails to
// spawn (e.g. ENOENT) or exits before becoming ready. The `error`/`exit`
// listeners are one-shot and removed once the race settles; a permanent
// error logger lives in startSidecar so a post-start error is never an
// uncaught throw.
function waitForReadyOrFailure(proc: ChildProcess, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Forward-declared so `cleanup` can reference them and they can
    // reference `cleanup` without a use-before-define cycle.
    let onError: (err: Error) => void = () => undefined;
    let onExit: (code: number | null) => void = () => undefined;
    const cleanup = () => {
      proc.removeListener("error", onError);
      proc.removeListener("exit", onExit);
    };
    onError = (err: Error) => {
      cleanup();
      reject(new Error(`spawn failed: ${errorMessage(err)}`));
    };
    onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`exited early (code ${code})`));
    };
    proc.once("error", onError);
    proc.once("exit", onExit);
    waitUntilReady(port)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function startSidecar(model: WhisperModelName): Promise<Sidecar> {
  const port = await findFreePort();
  const args = ["--model", modelFilePath(model), "--host", HOST, "--port", String(port)];
  log.info("whisper", "sidecar: spawning", { model, port });
  const proc = spawn("whisper-server", args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderrTail = { text: "" };
  drainStderr(proc, stderrTail);
  // Permanent error listener — a missing one would let a process 'error'
  // (e.g. ENOENT) throw uncaught and crash the server.
  proc.on("error", (err) => log.warn("whisper", "sidecar: process error", { model, error: errorMessage(err) }));
  proc.on("exit", (code) => {
    log.warn("whisper", "sidecar: exited", { model, code, stderrTail: stderrTail.text.slice(-500) });
    if (sidecar?.proc === proc) sidecar = null;
  });
  try {
    await waitForReadyOrFailure(proc, port);
  } catch (err) {
    proc.kill();
    throw new Error(`whisper-server failed to start: ${errorMessage(err)} — stderr: ${stderrTail.text.slice(-500)}`);
  }
  sidecar = { port, proc, model };
  log.info("whisper", "sidecar: ready", { model, port });
  return sidecar;
}

/** Get a running sidecar for `model`, spawning one (or replacing a
 *  sidecar bound to a different model) as needed. Concurrent callers
 *  share one in-flight start. */
async function ensureSidecar(model: WhisperModelName): Promise<Sidecar> {
  if (sidecar && sidecar.model === model && !sidecar.proc.killed) return sidecar;
  // Reuse an in-flight start only when it's for the SAME model; if a
  // different model is starting, let it settle first, then replace it.
  if (starting && starting.model === model) return starting.promise;
  if (starting) await starting.promise.catch(() => undefined);
  if (sidecar && sidecar.model === model && !sidecar.proc.killed) return sidecar;
  if (sidecar && sidecar.model !== model) stopWhisperSidecar();
  const promise = startSidecar(model).finally(() => {
    starting = null;
  });
  starting = { model, promise };
  return promise;
}

/** Pre-spawn the sidecar so the first real transcription doesn't pay the
 *  ~10s+ model-load cost inside the request. Fire-and-forget; idempotent
 *  (a running sidecar is reused). Errors are swallowed — a failed warm-up
 *  just means the first transcription retries the spawn and surfaces the
 *  error there. */
export async function warmupSidecar(model: WhisperModelName): Promise<void> {
  try {
    await ensureSidecar(model);
  } catch (err) {
    log.warn("whisper", "sidecar: warmup failed", { model, error: errorMessage(err) });
  }
}

function parseInferenceText(data: unknown): string {
  if (typeof data === "object" && data !== null && "text" in data) {
    const { text } = data as { text: unknown };
    if (typeof text === "string") return text;
  }
  return "";
}

/** Transcribe a 16 kHz mono WAV file via the warm sidecar. `language`
 *  is a Whisper language code or "auto". Returns the raw transcript. */
export async function transcribeWav(wavPath: string, language: string, model: WhisperModelName): Promise<string> {
  const active = await ensureSidecar(model);
  const buf = await readFile(wavPath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", "json");
  form.append("language", language || "auto");
  let res: Response;
  try {
    res = await fetch(`http://${HOST}:${active.port}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`whisper-server request failed: ${errorMessage(err)}`);
  }
  if (!res.ok) throw new Error(`whisper-server returned HTTP ${res.status}`);
  return parseInferenceText(await res.json());
}

/** Stop the running sidecar (idempotent). Wired to process shutdown. */
export function stopWhisperSidecar(): void {
  if (!sidecar) return;
  sidecar.proc.kill();
  sidecar = null;
}
