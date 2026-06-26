// Local voice-input transcription endpoints (Mac-only, whisper.cpp).
//
//   POST /api/transcribe              audio dataUrl → { text, durationMs }
//   GET  /api/transcribe/model        current capability + model status
//   POST /api/transcribe/model/download   start the model download (opt-in)
//
// All transcription happens on the machine running this server; no
// audio leaves it. See plans/done/feat-voice-input.md.

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { loadSettings } from "../../system/config.js";
import { stripDataUri } from "../../utils/files/attachment-store.js";
import { badRequest, payloadTooLarge, serverError, serviceUnavailable } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { getVoiceInputStatus, isVoiceInputReady, selectedModel, startModelDownload, transcribeAudio } from "../../system/whisper/index.js";

const router = Router();

// 60 s of opus at a generous bitrate is comfortably under this; the cap
// just bounds resource use against a bypassed/abusive client.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
// Raw data-URL cap, applied before decoding. Generous vs MAX_AUDIO_BYTES
// (base64 ~+33%, URL-encoding up to ~3x) but bounded so an oversized
// payload is rejected without first allocating the decoded buffer.
const MAX_DATAURL_CHARS = MAX_AUDIO_BYTES * 3;

interface TranscribeBody {
  dataUrl?: string;
  language?: string;
}

/** Whisper language code or "auto". Keep short codes; anything else
 *  (missing, junk) falls back to auto-detection from the audio. */
function normalizeLanguage(language: string | undefined): string {
  if (typeof language === "string" && language.length > 0 && language.length <= 5) return language;
  return "auto";
}

function approxBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

router.post(API_ROUTES.transcribe.run, async (req: Request<object, unknown, TranscribeBody>, res: Response) => {
  const settings = loadSettings();
  if (!isVoiceInputReady(settings)) {
    serviceUnavailable(res, "Voice input is not available (not enabled, unsupported platform, or model not ready).");
    return;
  }
  const { dataUrl, language } = req.body;
  if (!dataUrl) {
    badRequest(res, "dataUrl is required");
    return;
  }
  // Bound the raw payload BEFORE decoding so a giant (e.g. URL-encoded)
  // data URL can't be expanded into memory ahead of the post-decode cap.
  if (dataUrl.length > MAX_DATAURL_CHARS) {
    payloadTooLarge(res, "audio clip exceeds the size limit");
    return;
  }
  const parsed = stripDataUri(dataUrl);
  if (!parsed) {
    badRequest(res, "dataUrl must be a data: URI");
    return;
  }
  if (approxBytes(parsed.base64) > MAX_AUDIO_BYTES) {
    payloadTooLarge(res, "audio clip exceeds the size limit");
    return;
  }
  const startedAt = Date.now();
  try {
    const { text } = await transcribeAudio({
      base64: parsed.base64,
      mimeType: parsed.mimeType,
      language: normalizeLanguage(language),
      model: selectedModel(settings),
    });
    res.json({ text, durationMs: Date.now() - startedAt });
  } catch (err) {
    log.error("transcribe", "failed", { error: errorMessage(err) });
    serverError(res, "transcription failed");
  }
});

router.get(API_ROUTES.transcribe.model, (_req: Request, res: Response) => {
  res.json(getVoiceInputStatus(loadSettings()));
});

router.post(API_ROUTES.transcribe.modelDownload, (_req: Request, res: Response) => {
  const settings = loadSettings();
  if (!getVoiceInputStatus(settings).capable) {
    serviceUnavailable(res, "Voice input is not supported on this machine.");
    return;
  }
  startModelDownload(settings);
  res.json(getVoiceInputStatus(settings));
});

export default router;
