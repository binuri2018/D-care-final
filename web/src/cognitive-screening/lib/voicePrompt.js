/**
 * Voice assistant — text-to-speech wrapper around the browser's
 * SpeechSynthesis API.
 *
 * We use this to read every task prompt aloud, which improves
 * accessibility for elderly patients with reduced reading vision
 * (one of the validated "design-for-elderly" recommendations,
 * see Czaja 2019, "Designing for Older Adults").
 *
 * Languages: English by default, with optional Sinhala (si-LK)
 * and Tamil (ta-IN) when those voices are installed on the host OS.
 * We never block on speech — if voices fail or the API is missing,
 * the UI silently falls back to text-only.
 */

const LANG_CODES = {
  en: "en-US",
  si: "si-LK",
  ta: "ta-IN",
};

/** Web Speech API recognition language (change to "en-GB" if UK English works better). */
export const SPEECH_RECOGNITION_LANG = "en-US";

let cachedVoices = null;

function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  const v = window.speechSynthesis.getVoices();
  if (v && v.length) cachedVoices = v;
  return v || [];
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  // populate voices when the engine finishes loading them
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices() || [];
  };
}

function pickVoice(lang) {
  const voices = loadVoices();
  const target = LANG_CODES[lang] || lang || "en-US";
  return (
    voices.find((v) => v.lang && v.lang.toLowerCase() === target.toLowerCase()) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(target.split("-")[0])) ||
    voices.find((v) => /en-/i.test(v.lang)) ||
    null
  );
}

export function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text, opts = {}) {
  if (!isSpeechSynthesisSupported() || !text) {
    if (opts.onEnd) opts.onEnd();
    return false;
  }
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = opts.rate ?? 0.95;
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  u.lang = LANG_CODES[opts.lang] || opts.lang || "en-US";
  const v = pickVoice(opts.lang || "en");
  if (v) u.voice = v;
  if (opts.onEnd) {
    u.onend = () => opts.onEnd();
    u.onerror = () => opts.onEnd();
  }
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    if (opts.onEnd) opts.onEnd();
    return false;
  }
}

/**
 * Promise-returning convenience: resolves when TTS playback ends.
 * Always resolves; never rejects (we don't want voice failures to
 * block the test flow).
 */
export function speakAsync(text, opts = {}) {
  return new Promise((resolve) => {
    speak(text, { ...opts, onEnd: resolve });
  });
}

/** Estimate TTS duration in ms (~3.5 chars / sec at rate 0.95). */
export function estimateSpeakDuration(text) {
  if (!text) return 0;
  return Math.min(15000, Math.max(800, text.length * 70));
}

export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {}
}

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

export function devSpeechLog(...args) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log("[speech]", ...args);
  }
}

export function isBrowserSpeechRecognitionAvailable() {
  return (
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

/** True for https: or localhost / 127.0.0.1 / ::1 (typical safe dev URL). */
export function isLocalhostOrHttps() {
  if (typeof window === "undefined" || !window.location) return true;
  const { protocol, hostname } = window.location;
  if (protocol === "https:") return true;
  const h = String(hostname || "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") return true;
  return false;
}

/**
 * User-facing warning when the page is not served over HTTPS or localhost
 * (e.g. http://192.168.x.x) — SpeechRecognition may be blocked or flaky.
 */
export function getInsecureSpeechTransportWarning() {
  if (typeof window === "undefined") return null;
  if (isLocalhostOrHttps()) return null;
  return "Voice input may not work on insecure HTTP. Use localhost or HTTPS.";
}

export function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the browser is not playing TTS (or timeout). */
export async function waitForSpeechSynthesisIdle(timeoutMs = 8000) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const t0 = performance.now();
  while (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (performance.now() - t0 > timeoutMs) {
      devSpeechLog("waitForSpeechSynthesisIdle: timeout");
      break;
    }
    await waitMs(50);
  }
}

/**
 * Open and immediately release the default mic so the browser's audio input
 * path is active before Web Speech API recognition — often required on
 * Chrome/Edge (Windows) after TTS or idle tabs.
 * @returns {{ ok: true } | { ok: false, message: string, code?: string }}
 */
export async function primeMicrophoneForRecognition() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const message = "Microphone API unavailable in this browser.";
    devSpeechLog("primeMicrophone: no getUserMedia", message);
    return { ok: false, message, code: "no-mediadevices" };
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach((t) => t.stop());
    devSpeechLog("primeMicrophone: ok");
    return { ok: true };
  } catch (e) {
    const name = e?.name || "";
    const denied = name === "NotAllowedError" || name === "PermissionDeniedError";
    const message = denied
      ? "Microphone permission was denied or unavailable."
      : `Microphone permission was denied or unavailable. (${e?.message || name || "unknown"})`;
    devSpeechLog("primeMicrophone: failed", name, e?.message);
    return { ok: false, message, code: denied ? "mic-denied" : "mic-error" };
  }
}

/** Human-readable copy for MicStatus / banners (code from SpeechRecognitionError). */
export function speechRecognitionErrorMessage(code) {
  switch (code) {
    case "network":
      return "Speech recognition needs internet or the browser STT service is blocked.";
    case "not-allowed":
      return "Microphone permission blocked. Allow mic access in browser settings.";
    case "no-speech":
      return "No speech detected. Try speaking closer to the mic.";
    case "audio-capture":
      return "No microphone device found or browser cannot capture audio.";
    case "aborted":
      return "Speech recognition was interrupted.";
    case "service-not-allowed":
      return "Speech service is blocked by browser, network, or policy.";
    case "bad-grammar":
      return "Speech recognition grammar is not supported.";
    default:
      return code ? `Speech recognition: ${code}` : "Speech recognition error.";
  }
}
