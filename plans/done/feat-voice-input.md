# MulmoClaude — Local Voice Input via whisper.cpp sidecar

**Feature:** Voice input in the chat screen. Audio is captured in the
browser, sent to the local Express server, and transcribed by a **whisper.cpp
binary run as a separate process** (Mac, Metal-accelerated). The transcript is
inserted into the chat input box for review before sending.

> **Implementation note (supersedes the push-to-talk wording below):** v1 shipped
> as a **toggle**, not push-to-talk — click to start listening, click to stop.
> While listening, a Web Audio VAD finalizes a segment on each pause (or a 20s
> cap) and transcribes it. The mic is **sticky for the session**: it pauses while
> the agent runs and auto-resumes on the user's turn, until toggled off (state is
> in-memory only, reset on session change). The §8 push-to-talk discussion is
> retained for historical context.

**Status:** Implemented (pending review) — landed on `feat/local-voice-input` (PR #1773). See §11 for what each phase shipped.
**Owner:** _TBD_
**Last updated:** 2026-06-24

---

## 1. Goal

Let a user dictate a chat message instead of typing. Hold a mic button, speak one
utterance, release; the transcribed text is inserted into the chat input for
review. On Mac, transcription runs entirely on the machine running MulmoClaude —
no audio leaves the device, no per-minute API cost.

Scoped as **batch-per-utterance** (one clip in → one transcript out), not live
streaming.

### Non-goals (v1)
- Real-time word-by-word streaming.
- Speaker diarization.
- Voice **output** / TTS.

### Explicitly in-scope as a design constraint (not v1 implementation)
- **Windows / cross-platform later via OpenAI's transcription API.** The endpoint
  contract and the renderer are provider-agnostic from day one so a cloud backend
  drops in behind the same `/api/transcribe` without touching the UI (see §4, §12).

---

## 2. Architecture (grounded in this codebase)

MulmoClaude is **not** Electron. It is a Vue 3 SPA (Vite) + an **Express server on
localhost** (`server/index.ts`, port 3001; Vite proxy 5173 in dev), distributed as
`npx mulmoclaude` / `npm i -g mulmoclaude`. The Node side that runs inference *is*
that Express server, running on the user's Mac by default.

```text
┌──────────────────────────────┐        ┌────────────────────────────────────────┐
│  Renderer (ChatInput.vue)    │        │  Express server (localhost, user's Mac)  │
│                              │        │                                          │
│  Mic button (push-to-talk)   │ apiPost│  POST /api/transcribe                    │
│  MediaRecorder → webm/opus   │ ─────▶ │   1. decode base64 dataUrl → temp .webm  │
│  Blob → base64 dataUrl       │  JSON  │   2. ffmpeg → 16kHz mono WAV (temp)      │
│                              │        │   3. provider.transcribe(wav, lang)      │
│  ◀── { text, durationMs } ───│ ◀───── │        local: whisper.cpp sidecar (HTTP) │
│  Insert/append into textarea │  JSON  │        cloud: OpenAI API (future)        │
│  (review, then send)         │        │   4. cleanup temp files (finally)        │
└──────────────────────────────┘        └────────────────────────────────────────┘
```

**Why this matches the repo:**
- **No multipart.** Uploads in this codebase travel as **base64 data URIs** via
  `apiPost` (`src/utils/api.ts`, auto-attaches the bearer token). See
  `/api/attachments` → `server/api/routes/attachment.ts` taking `{ dataUrl }`.
  `/api/transcribe` follows the same shape — no multer/formidable added.
- **ffmpeg is already an optional dep**, probed at boot with `which ffmpeg`
  (`server/system/optionalDeps.ts`, id `ffmpeg`) and gated via `depStatus("ffmpeg")`.
  We reuse that. This would be the first place the repo spawns ffmpeg *directly*
  (today it's delegated to the `mulmocast` lib), so add a small
  `server/utils/audio/ffmpeg.ts` wrapper that `execFile`s the system binary.
- **Capabilities already ride on `/api/health`** (polled every 15s by
  `src/composables/useHealth.ts`; already carries `geminiAvailable`,
  `sandboxEnabled`). We add a `transcribeAvailable` flag there — no new
  `/api/capabilities` endpoint.

---

## 3. Transcription backend: whisper.cpp as a separate process

**Decision: run the whisper.cpp binary as a separate process, not an in-process
native addon.** This matches how the repo treats heavy dependencies (ffmpeg,
LibreOffice are spawned/probed external binaries; the only native runtime addon is
`node-pty`, and it's `optionalDependencies`). A native `.node` whisper addon shipped
through `npx mulmoclaude` would have to match the user's exact Node ABI + arch or
fail to install — a real support burden for a tarball install.

**Warm-model strategy — spawn `whisper-server` as a managed sidecar:**
- A one-shot `whisper-cli` invocation reloads the model weights on every call,
  which defeats the warm-model performance target (§9). Instead, on first use the
  server lazily spawns **`whisper-server`** (whisper.cpp's HTTP server mode) as a
  child process bound to `127.0.0.1:<ephemeral port>` with the model preloaded, and
  reuses it across requests.
- The sidecar lifecycle (spawn, health-check, restart-on-crash, kill on shutdown)
  lives in a single module: `server/system/whisper/sidecar.ts`.
- `/api/transcribe` POSTs the WAV to the sidecar's local HTTP endpoint and returns
  `{ text, durationMs }`.

**Probe & gate (reuse `optionalDeps.ts`):**
- Add a registry entry: `{ id: "whisper", command: "whisper-server", enables: "voiceInput" }`.
  (Phase 0 confirms the exact binary name shipped by Homebrew's `whisper-cpp`
  formula; `whisper-cli` is the one-shot fallback if `whisper-server` is absent.)
- The `probe` callback also verifies a model file is present under `{workspace}/models`.

**Provider abstraction (for the Windows/cloud future):**
```ts
// server/system/transcribe/provider.ts
interface TranscribeProvider {
  readonly id: "whisper-local" | "openai";
  available(): boolean;                                   // feeds /api/health
  transcribe(wavPath: string, language: string): Promise<{ text: string }>;
}
```
- v1 ships `whisper-local` only. The OpenAI provider (`gpt-4o-mini-transcribe` /
  `whisper-1`) is a later drop-in that satisfies the same interface — selected when
  local is unavailable (e.g. Windows) and an API key is configured.

---

## 4. Platform gating

`transcribeAvailable` in `/api/health` is **capability-based**, the union of:
- **Local (v1):** the user has **enabled voice input in settings**
  (`AppSettings.voiceInput.enabled`) **AND** `process.platform === 'darwin'` **AND**
  `depStatus("whisper")?.available` **AND** `depStatus("ffmpeg")?.available` **AND**
  the selected model is present + ready under `{workspace}/models`
  (`transcribeModel.state === "ready"`).
- **Cloud (future):** an OpenAI transcription key configured in settings.

The renderer **hides** the mic button entirely when `transcribeAvailable` is false
(no disabled/teasing control). `/api/transcribe` returns **503** (capability
unavailable) as a defense-in-depth guard if the UI is bypassed — consistent with how
ffmpeg-gated routes already respond.

> v1 hard-restricts local transcription to macOS for quality (Metal). The
> capability-based flag means a Windows user who later configures the OpenAI
> provider lights up the same button with zero renderer changes.

---

## 5. Model management

- **Storage:** `{workspace}/models/` — a **new top-level workspace dir**, a peer of
  `data/` (like the existing `feeds/`, `github/`, `plugins/`, `archive/` top-level
  dirs). **Deliberately NOT under `data/`**, which the user manages with git — model
  weights are large binaries and must stay out of the git-tracked tree.
  - Add `models: "models"` to `HOST_WORKSPACE_DIRS` in `server/workspace/paths.ts`.
    The absolute path (`WORKSPACE_PATHS.models`) is auto-derived. Do **not** add it
    to `EAGER_WORKSPACE_DIRS` — create it lazily on first download.
  - Ensure `{workspace}/models/` is git-ignored (the workspace's own `.gitignore`,
    not the app repo).
- **Default model:** `large-v3-turbo` — strong Japanese accuracy, near-real-time on
  Apple Silicon with Metal.
- **Optional lighter models:** `small` / `base` for low-RAM machines, via settings.
- **Distribution:** the `mulmoclaude` tarball (~50 MB) must **not** bundle weights
  (1–3 GB).
- **No automatic download. The user opts in from Settings.** Voice input ships
  **off**. A control in the settings UI lets the user **explicitly enable** the
  feature; toggling it on is what **starts the model download**. This keeps the
  1–3 GB pull a deliberate, user-initiated action rather than a surprise on first
  boot, and avoids fetching weights on machines that never use the feature.
- **Download lifecycle (kicked off by the enable toggle):**
  - The enable control is only shown / actionable on a Mac with the whisper binary
    present (otherwise it explains why voice input is unavailable — see §4).
  - On enable, the server begins a background download of the selected model and
    exposes progress via `/api/health` (e.g. `transcribeModel: { state:
    "idle" | "downloading" | "ready" | "error", progress?: number }`).
  - Verify size/checksum before marking `ready`; resume/retry on partial download;
    surface errors in the settings UI with a retry affordance.
  - The mic button appears only once the feature is enabled **and**
    `transcribeModel.state === "ready"`. While `downloading`, the settings UI shows
    progress; the mic button stays hidden.
  - Disabling the feature hides the mic button; offer (but don't force) deleting the
    downloaded weights from `{workspace}/models` to reclaim disk.
- **Config:** stored in `AppSettings` (see §6); dev override via `MULMO_WHISPER_MODEL`.

---

## 6. Settings (`server/system/config.ts`)

Extend `AppSettings` following the existing `effortLevel` pattern (interface field +
validator + clone + `DEFAULT_SETTINGS` + `/api/config` exposure):

- `voiceInput?: { enabled?: boolean; model?: string }`:
  - `enabled` (default `false`) — the user's explicit opt-in from the settings UI.
    Flipping it `true` is what triggers the model download (§5); it gates
    `transcribeAvailable` (§4). Persisted via `/api/config/settings` like any other
    setting.
  - `model` — selected whisper model name (default `large-v3-turbo`). The model
    **path** is derived from `WORKSPACE_PATHS.models` + name, not stored, so it stays
    portable across machines.
- `/api/health` should expose enough for the settings UI to render correctly even
  before enabling: a **capability** signal (Mac + whisper binary present, i.e. "this
  toggle is offerable") distinct from the **enabled + model-ready** signal that gates
  the mic button. The `transcribeModel.state` field carries download progress.
- (Future) `voiceInput.provider?: "whisper-local" | "openai"` and an OpenAI key
  reference — added when the cloud backend lands; not in v1.

Read via `/api/config` (GET), patched via `/api/config/settings` (PUT) as today.

---

## 7. Backend endpoint

### Contract
- **Route:** `POST /api/transcribe` (register in `src/config/apiRoutes.ts` →
  `API_ROUTES`, handler `server/api/routes/transcribe.ts`).
- **Request (JSON):** `{ dataUrl: string, language?: string }`. `language` is a
  Whisper language code or `"auto"`. The renderer seeds it from the browser-resolved
  UI locale (§8); the server falls back to `"auto"` if the field is absent or
  unrecognized. Same dataUrl convention as `/api/attachments`.
- **Response:** `200 { text: string, durationMs: number }`.
- **Errors:** `400` (no/invalid audio), `413` (over size/duration cap), `503`
  (capability unavailable / model still downloading), `500` (transcription failure).

### Pipeline
1. Guard: reject with `503` if `transcribeAvailable` is false.
2. Decode the dataUrl; enforce caps (≤ 60 s, ≤ a few MB) → `413` if exceeded.
3. Write a temp `utterance-<uuid>.webm` (temp file *alongside* its destination,
   per the repo's atomic-write convention — never `os.tmpdir()`).
4. ffmpeg → 16 kHz mono 16-bit WAV (temp), via `server/utils/audio/ffmpeg.ts`.
5. `provider.transcribe(wavPath, language)` → text.
6. Normalize (trim, collapse leading spaces / whisper artifacts).
7. Return `{ text, durationMs }`.
8. **`finally`:** delete all temp files, including on error.

### Concurrency
- Serialize per session (one inference at a time) or a tiny queue — concurrent
  large-model inferences contend for the GPU and spike memory. The single
  `whisper-server` sidecar naturally serializes if we don't fan out requests.

### Logging
- Use `log.{info,warn,error}` (`docs/logging.md`) — never `console.*`. Log locally
  only; no transcript text in logs beyond what chat already stores.

---

## 8. Renderer: capture & UX (`src/components/ChatInput.vue`)

### Control
- A mic button in the chat input area, shown **only** when `transcribeAvailable`
  (read from `useHealth()`). Icon-only chrome control per CLAUDE.md sizing:
  `h-8 w-8 flex items-center justify-center rounded`, **Material Icons** (`mic`),
  **no emoji**.
- **Push-to-talk** for v1: hold to record, release to stop + transcribe. Clearest
  end-of-utterance signal, no VAD risk. Keyboard-activatable + ARIA label.
- Capture with `MediaRecorder` (`audio/webm;codecs=opus`); accumulate chunks into one
  Blob; convert to a base64 dataUrl (reuse the existing `pastedFiles` dataUrl path —
  `{ dataUrl, name, mime }`).

### Language
- **Default is auto-detected from the browser.** Reuse the locale the app already
  resolved in `src/lib/vue-i18n.ts` (which reads `navigator.languages` →
  `navigator.language` and matches by primary subtag). Map that to a Whisper
  language code and pass it as `language` on the request — no new navigator-reading
  code, and the Japanese primary audience gets the right default with zero config.
- **UI language ≠ spoken language**, so also expose:
  - a small **language selector** (next to the mic) that overrides the default per
    session, and
  - an **`auto`** option that lets Whisper detect the spoken language from the audio
    (robust to UI/spoken mismatch; slightly slower, can mis-detect on very short
    clips — hence not the default when we already have a strong UI-locale prior).
- Whisper's language set is wider than the 8 UI locales; if `navigator.language`'s
  primary subtag maps to a Whisper-supported language the UI doesn't have, prefer
  that finer code over collapsing to the coarse UI locale.

### States & feedback
- `idle → requesting-permission → recording (level meter) → transcribing (spinner) →
  done / error`.
- **Insert for review, do not auto-send.** The textarea is `v-model`-bound
  (`data-testid="user-input"`); set text via the `update:modelValue` path and reuse
  the existing `setSelectionRange` cursor handling (already used for skill insertion).
- If the input already has text, **append** with a separating space, don't overwrite.
- Empty transcript (silence) → insert nothing; show a subtle "didn't catch that" hint.

### Errors & permissions
- Every `apiPost` / `fetch` handles **both** network errors (try/catch) **and**
  `!response.ok` (CLAUDE.md rule).
- Denied mic permission → clear message + system-settings guidance.
- `503` (model downloading / capability off) → non-blocking notice.

### i18n
- All new strings (mic label, "didn't catch that", permission/error messages) go
  into **all 8 locale files** (`src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`), extracted
  to `en.ts` first, keys in lockstep. No hardcoded template strings.

---

## 9. Performance targets (Apple Silicon, large-v3-turbo)

- A 5–15 s utterance transcribes in well under its own duration once warm.
- **Keep the model warm** — the `whisper-server` sidecar holds weights in memory
  across requests (the whole reason for §3's server-mode choice).
- Offer `small` / `base` as a fallback on lower-RAM machines.

---

## 10. Privacy & security

- On the local (Mac) path, audio is processed entirely on the machine running
  MulmoClaude; **no audio or transcript leaves that machine.** Phrase user-facing
  copy as "on the machine running MulmoClaude" (the default is the user's Mac, but
  the server *can* be run remotely — don't over-promise "never leaves your device").
- Temp audio + WAV files deleted immediately after transcription.
- No transcript logging beyond what chat already stores.
- Enforce upload size + duration caps to prevent resource exhaustion.
- The cloud (OpenAI) path, when added, **does** send audio off-device — surface that
  explicitly in settings before enabling it.

---

## 11. Implementation phases

**Phase 0 — Spike (½–1 day).** Install whisper.cpp (Homebrew `whisper-cpp`) + a
`large-v3-turbo` model on a dev Mac. Confirm the exact binary names (`whisper-server`
vs `whisper-cli`), confirm Metal is engaged, run `whisper-server` and hit its HTTP
endpoint with a sample WAV, measure warm-vs-cold latency. Validate the
provider-interface assumptions before committing.

**Phase 1 — Backend.** `server/system/whisper/sidecar.ts` (spawn/health/restart/kill),
`server/system/transcribe/provider.ts` (interface + `whisper-local` impl),
`server/utils/audio/ffmpeg.ts` (webm→WAV), `server/api/routes/transcribe.ts`,
`whisper` entry in `optionalDeps.ts`, `transcribeAvailable` in `/api/health`,
`models` dir in `paths.ts`. Temp-file cleanup, size/duration caps, 503 guard.

**Phase 2 — Model management.** Settings UI to **enable voice input** (offered only
when Mac + whisper binary present); enabling triggers a background model download
with progress surfaced on `/api/health`, integrity check, resume/retry, error +
retry affordance. `{workspace}/models` storage, `AppSettings.voiceInput.{enabled,model}`,
model selection, optional weight-deletion on disable. Mic button gated on
`enabled && transcribeModel.state === "ready"`.

**Phase 3 — Renderer UX.** Capability-gated mic button, push-to-talk capture,
state machine, insert/append-into-textarea, permission + error handling, i18n ×8,
e2e test (`data-testid` selectors, `mockAllApis`).

**Phase 4 — Hardening.** Concurrency/queueing, sidecar crash recovery, edge cases
(very short / capped-long / noisy clips), accessibility, local-only telemetry.

**Phase 5 — QA & release.** Regression clip set (good/noisy mic, JA/EN/mixed,
numbers, product names), verify the button is fully absent when `transcribeAvailable`
is false, document the privacy posture.

**(Future, separate plan) — OpenAI provider.** Add `openai` provider satisfying the
§3 interface, settings for provider choice + key, light up `transcribeAvailable` on
Windows. Renderer unchanged.

---

## 12. Resolved decisions (was "open questions")

| Question | Decision |
|---|---|
| Electron main vs separate node service? | **Moot** — single Express server on localhost; endpoint lives there. |
| Native addon vs subprocess? | **Subprocess** — spawn `whisper-server` sidecar (warm model), probed via `optionalDeps`. |
| Bundle `ffmpeg-static` vs system ffmpeg? | **System ffmpeg**, reuse existing `optionalDeps` probe + gate. |
| Model storage location? | **`{workspace}/models/`** — new top-level dir, NOT under git-managed `data/`. |
| Multipart vs base64? | **base64 dataUrl** via `apiPost`, matching `/api/attachments`. |
| Capabilities transport? | **`/api/health`** `transcribeAvailable` flag, not a new endpoint. |
| Push-to-talk vs VAD? | **Push-to-talk** for v1; VAD deferred. |
| Cross-platform? | **Mac-only local in v1**; Windows later via OpenAI provider behind the same contract. |
| Default language? | **Auto-detected from the browser** (reuse `vue-i18n` locale → Whisper code), with a per-session selector + an `auto` option. |
| Model download UX? | **Explicit opt-in from Settings.** Feature ships off; enabling it in the settings UI (offered only when Mac + whisper binary present) triggers the download; progress on `/api/health`, non-blocking. |

### Still open
- _(none — all prior open questions resolved.)_

---

## 13. Future enhancements (post-v1)

- OpenAI transcription provider → Windows/cross-platform (see §11 future phase).
- Live streaming transcription (chunked PCM) for see-as-you-speak.
- Toggle + VAD auto-stop.
- Speaker diarization.
- Custom vocabulary / prompt biasing for domain terms.
