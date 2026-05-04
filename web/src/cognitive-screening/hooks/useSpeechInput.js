import { useCallback, useEffect, useRef, useState } from "react";
import {
  stopSpeaking,
  waitMs,
  waitForSpeechSynthesisIdle,
  primeMicrophoneForRecognition,
  SPEECH_RECOGNITION_LANG,
  devSpeechLog,
  isBrowserSpeechRecognitionAvailable,
} from "../lib/voicePrompt.js";

const FATAL_SPEECH_RECOGNITION_ERRORS = new Set([
  "network",
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
]);

/**
 * Web Speech API wrapper that emits per-question speech samples with
 * lightweight clarity + sentiment heuristics. If the API is not available
 * (e.g. Firefox), `supported` is false and the UI should hide controls.
 */
const HESITATION = new Set(["um", "uh", "hmm", "er", "uhm", "ah", "hm", "eh"]);
const POS = new Set(["good", "fine", "ok", "yes", "right", "great", "easy", "sure", "got"]);
const NEG = new Set(["bad", "no", "wrong", "hard", "confused", "tired", "lost", "forget", "forgot"]);

const RESTART_AFTER_END_MS = 380;
const RETRY_ALREADY_STARTED_MS = 300;

function clarityFromTokens(tokens) {
  if (tokens.length === 0) return 0;
  const hes = tokens.filter((t) => HESITATION.has(t)).length;
  const hesRatio = hes / Math.max(1, tokens.length);
  const lenScore = Math.min(1, tokens.length / 8);
  return Math.max(0, Math.min(100, (1 - hesRatio) * 70 + lenScore * 30));
}

function sentimentFromTokens(tokens) {
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POS.has(t)) pos += 1;
    if (NEG.has(t)) neg += 1;
  }
  if (pos + neg === 0) return 50;
  const balance = (pos - neg) / (pos + neg);
  return ((balance + 1) / 2) * 100;
}

export function analyzeTranscript(transcript) {
  const tokens = String(transcript || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return {
    transcript: String(transcript || ""),
    hesitation_count: tokens.filter((t) => HESITATION.has(t)).length,
    clarity_score: Number(clarityFromTokens(tokens).toFixed(2)),
    sentiment_score: Number(sentimentFromTokens(tokens).toFixed(2)),
  };
}

export function useSpeechInput() {
  const Recog =
    typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
  const [supported] = useState(() => isBrowserSpeechRecognitionAvailable());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const [softHint, setSoftHint] = useState(null);
  const recogRef = useRef(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const wantListeningRef = useRef(false);
  const restartTimerRef = useRef(null);
  const manualStopRef = useRef(false);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current != null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const shutdownFromFatalSpeechError = useCallback(
    (code) => {
      wantListeningRef.current = false;
      clearRestartTimer();
      setListening(false);
      setSoftHint(null);
      setError(code);
      try {
        recogRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [clearRestartTimer]
  );

  useEffect(() => {
    if (!Recog) return;
    const r = new Recog();
    r.continuous = true;
    r.interimResults = true;
    r.lang = SPEECH_RECOGNITION_LANG;
    r.onresult = (e) => {
      setSoftHint(null);
      let final = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += " " + txt;
        else inter += " " + txt;
      }
      if (final) finalRef.current = (finalRef.current + " " + final).trim();
      const interTrim = inter.trim();
      interimRef.current = interTrim;
      setInterim(interTrim);
    };
    r.onerror = (ev) => {
      const code = ev?.error || "speech-error";
      devSpeechLog("useSpeechInput onerror", code);
      if (code === "aborted") {
        if (manualStopRef.current) return;
        wantListeningRef.current = false;
        clearRestartTimer();
        setError("aborted");
        setListening(false);
        return;
      }
      if (code === "no-speech") {
        setSoftHint("no-speech");
        return;
      }
      if (FATAL_SPEECH_RECOGNITION_ERRORS.has(code)) {
        shutdownFromFatalSpeechError(code);
        return;
      }
      setError(code);
    };
    r.onend = () => {
      devSpeechLog("useSpeechInput onend", wantListeningRef.current);
      if (!wantListeningRef.current) {
        setListening(false);
        return;
      }
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!wantListeningRef.current || !recogRef.current) return;
        try {
          recogRef.current.start();
          setListening(true);
          devSpeechLog("useSpeechInput restarted");
        } catch {
          setListening(false);
        }
      }, RESTART_AFTER_END_MS);
    };
    recogRef.current = r;
    return () => {
      wantListeningRef.current = false;
      manualStopRef.current = true;
      clearRestartTimer();
      try {
        r.stop();
      } catch {}
      recogRef.current = null;
    };
  }, [Recog, clearRestartTimer, shutdownFromFatalSpeechError]);

  const start = useCallback(async () => {
    if (!Recog) {
      return {
        ok: false,
        error: "Voice input is supported only in Chrome or Edge.",
      };
    }
    if (!recogRef.current) {
      return {
        ok: false,
        error: "Speech recognition is still initializing. Try again in a moment.",
      };
    }
    devSpeechLog("useSpeechInput.start()");
    manualStopRef.current = false;
    stopSpeaking();
    await waitMs(120);
    await waitForSpeechSynthesisIdle(8000);
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
      await waitMs(200);
    }
    const prime = await primeMicrophoneForRecognition();
    if (!prime.ok) {
      const msg = prime.message || "Microphone permission was denied or unavailable.";
      setError(msg);
      setListening(false);
      return { ok: false, error: msg };
    }
    setError(null);
    setSoftHint(null);
    wantListeningRef.current = true;
    finalRef.current = "";
    interimRef.current = "";
    setInterim("");
    const r = recogRef.current;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (/already started|already running/i.test(msg)) {
        try {
          r.stop();
        } catch {}
        await waitMs(RETRY_ALREADY_STARTED_MS);
        try {
          r.start();
          setListening(true);
        } catch {
          setListening(false);
          return { ok: false, error: "Could not start speech recognition." };
        }
        return { ok: true };
      }
      setListening(false);
      return { ok: false, error: msg || "Could not start speech recognition." };
    }
    return { ok: true };
  }, [Recog]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    wantListeningRef.current = false;
    clearRestartTimer();
    if (!recogRef.current) return null;
    try {
      recogRef.current.stop();
    } catch {}
    setListening(false);
    setSoftHint(null);
    const tail = (interimRef.current || "").trim();
    if (tail) finalRef.current = `${finalRef.current} ${tail}`.trim();
    interimRef.current = "";
    setInterim("");
    const sample = analyzeTranscript((finalRef.current || "").trim());
    setTimeout(() => {
      manualStopRef.current = false;
    }, 400);
    return sample;
  }, [clearRestartTimer]);

  return { supported, listening, interim, error, softHint, start, stop };
}
