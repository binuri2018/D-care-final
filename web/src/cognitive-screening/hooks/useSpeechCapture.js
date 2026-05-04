import { useCallback, useEffect, useRef, useState } from "react";
import {
  stopSpeaking,
  waitMs,
  waitForSpeechSynthesisIdle,
  primeMicrophoneForRecognition,
  SPEECH_RECOGNITION_LANG,
  devSpeechLog,
  isBrowserSpeechRecognitionAvailable,
  speechRecognitionErrorMessage,
} from "../lib/voicePrompt.js";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

/** Errors after which we must not auto-restart recognition. */
const FATAL_SPEECH_RECOGNITION_ERRORS = new Set([
  "network",
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
]);

/**
 * Robust per-task Web Speech API wrapper.
 *
 * Why this exists in addition to `useSpeechInput.js`:
 *   - The browser-side SpeechRecognition object stops on long silences
 *     and errors (no-speech, network, audio-capture). With
 *     continuous=true it still emits `onend` periodically. We
 *     auto-restart while the caller is still in a "want to listen"
 *     state.
 *   - Each capture is bound to a *task id* so the caller can collect
 *     a separate transcript per cognitive task (verbal fluency,
 *     picture description, life conversation, etc.) instead of one
 *     blob for the whole session.
 *   - Common errors are surfaced as a structured `error` value the
 *     UI can show with recovery instructions.
 */

const HESITATION = new Set(["um", "uh", "hmm", "er", "uhm", "ah", "hm", "eh", "mm"]);
const POS = new Set([
  "good", "fine", "ok", "okay", "yes", "right", "great",
  "easy", "sure", "got", "remember", "happy",
]);
const NEG = new Set([
  "bad", "no", "wrong", "hard", "confused", "tired",
  "lost", "forget", "forgot", "sad", "anxious",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function clarity(tokens) {
  if (!tokens.length) return 0;
  const hes = tokens.filter((t) => HESITATION.has(t)).length;
  const hesRatio = hes / Math.max(1, tokens.length);
  const lenScore = Math.min(1, tokens.length / 8);
  return Math.max(0, Math.min(100, (1 - hesRatio) * 70 + lenScore * 30));
}

function sentiment(tokens) {
  let pos = 0, neg = 0;
  for (const t of tokens) {
    if (POS.has(t)) pos++;
    if (NEG.has(t)) neg++;
  }
  if (pos + neg === 0) return 50;
  return ((pos - neg) / (pos + neg) + 1) / 2 * 100;
}

function typeTokenRatio(tokens) {
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

function meanLengthOfUtterance(text) {
  if (!text) return 0;
  const utts = text.split(/[.!?;]+/).map((u) => u.trim()).filter(Boolean);
  if (!utts.length) return text.split(/\s+/).filter(Boolean).length;
  const lens = utts.map((u) => u.split(/\s+/).filter(Boolean).length);
  return lens.reduce((a, b) => a + b, 0) / lens.length;
}

function repetitionRate(tokens) {
  if (tokens.length < 2) return 0;
  let rep = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) rep++;
  }
  let bigramRep = 0;
  for (let i = 3; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 2] && tokens[i - 1] === tokens[i - 3]) bigramRep++;
  }
  return Math.min(1, (rep + bigramRep) / Math.max(1, tokens.length - 1));
}

const SUBORDINATORS = new Set([
  "because", "although", "though", "while", "whereas", "since",
  "after", "before", "when", "whenever", "until", "unless",
  "if", "as", "so", "that", "which", "who", "where", "why",
]);

function sentenceComplexityScore(text, tokens) {
  if (!tokens.length) return 0;
  const mlu = meanLengthOfUtterance(text);
  const subs = tokens.filter((t) => SUBORDINATORS.has(t)).length;
  const subDensity = subs / tokens.length;
  const mluPart = Math.min(1, mlu / 12) * 70;
  const subPart = Math.min(1, subDensity / 0.05) * 30;
  return Math.round(mluPart + subPart);
}

function wordsPerMinute(wordCount, durationSec) {
  if (!durationSec || durationSec < 0.1) return 0;
  return (wordCount / durationSec) * 60;
}

export function analyzeTranscript(transcript, opts = {}) {
  const tokens = tokenize(transcript);
  const wpm = opts.durationSec
    ? wordsPerMinute(tokens.length, opts.durationSec)
    : null;
  const pauseTotal = opts.pauseTotalMs ?? null;
  const pauseLong = opts.pauseLongCount ?? null;
  return {
    transcript: String(transcript || ""),
    word_count: tokens.length,
    unique_word_count: new Set(tokens).size,
    hesitation_count: tokens.filter((t) => HESITATION.has(t)).length,
    clarity_score: Number(clarity(tokens).toFixed(2)),
    sentiment_score: Number(sentiment(tokens).toFixed(2)),
    type_token_ratio: Number(typeTokenRatio(tokens).toFixed(3)),
    mean_length_of_utterance: Number(meanLengthOfUtterance(transcript).toFixed(2)),
    repetition_rate: Number(repetitionRate(tokens).toFixed(3)),
    sentence_complexity: sentenceComplexityScore(transcript, tokens),
    duration_sec: opts.durationSec ?? null,
    words_per_minute: wpm == null ? null : Math.round(wpm),
    pause_total_ms: pauseTotal,
    long_pause_count: pauseLong,
    cognitive_slowdown_flag:
      wpm != null && wpm > 0 && wpm < 100,
    excessive_repetition_flag:
      tokens.length >= 20 && repetitionRate(tokens) > 0.08,
    excessive_hesitation_flag:
      tokens.length >= 20 &&
      tokens.filter((t) => HESITATION.has(t)).length / tokens.length > 0.08,
  };
}

/** Domain-specific extractors. */
export function countAnimalsInTranscript(transcript) {
  const list = new Set([
    "dog","cat","cow","horse","goat","sheep","pig","chicken","duck","goose","rabbit","hen","rooster",
    "lion","tiger","leopard","cheetah","bear","panda","wolf","fox","deer","elephant","giraffe",
    "zebra","hippo","hippopotamus","rhino","rhinoceros","kangaroo","koala","monkey","gorilla",
    "ape","chimpanzee","baboon","camel","donkey","mule","squirrel","mouse","rat","hamster",
    "guinea","pig","ferret","beaver","otter","raccoon","skunk","badger","seal","walrus","whale",
    "dolphin","shark","fish","goldfish","tuna","salmon","trout","cod","bass","perch","sardine",
    "octopus","squid","crab","lobster","shrimp","clam","mussel","oyster","jellyfish","starfish",
    "snail","worm","ant","bee","wasp","hornet","fly","mosquito","spider","beetle","butterfly",
    "moth","caterpillar","grasshopper","cricket","cockroach","dragonfly","ladybug","scorpion",
    "snake","cobra","python","lizard","gecko","iguana","chameleon","turtle","tortoise","frog",
    "toad","crocodile","alligator","eagle","hawk","falcon","owl","vulture","crow","raven",
    "sparrow","robin","parrot","peacock","pigeon","dove","seagull","penguin","ostrich","emu",
    "swan","stork","flamingo","heron","turkey","quail","pheasant","mongoose","platypus",
    "iguana","newt","salamander","jaguar","puma","lynx","cougar","leopard","panther","hyena",
  ]);
  const tokens = tokenize(transcript);
  const seen = new Set();
  for (const t of tokens) {
    if (list.has(t)) seen.add(t);
  }
  return { unique_animals: seen.size, named: Array.from(seen) };
}

const RESTART_AFTER_END_MS = 420;
const RETRY_ALREADY_STARTED_MS = 320;
const NATIVE_START_TIMEOUT_MS = 2000;

export function useSpeechCapture() {
  const Recog =
    typeof window !== "undefined"
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;
  const [supported] = useState(() => isBrowserSpeechRecognitionAvailable());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState(null);
  const [softHint, setSoftHint] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const activeTaskIdRef = useRef(null);

  const recogRef = useRef(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const wantListeningRef = useRef(false);
  const startTimerRef = useRef(null);
  const manualStopRef = useRef(false);
  const nativeActiveRef = useRef(false);
  /** Resolves when the native engine fires onstart (or rejects on timeout / fatal). */
  const nativeStartGateRef = useRef(null);

  const startTimeRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const pauseTotalRef = useRef(0);
  const longPauseCountRef = useRef(0);
  const LONG_PAUSE_MS = 1500;

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current != null) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  const closeNativeStartGate = useCallback((outcome) => {
    const g = nativeStartGateRef.current;
    if (!g) return;
    clearTimeout(g.timer);
    nativeStartGateRef.current = null;
    try {
      if (outcome?.ok) g.resolve();
      else g.reject(outcome);
    } catch {
      /* ignore */
    }
  }, []);

  const disposeRecognizer = useCallback(() => {
    clearStartTimer();
    const r = recogRef.current;
    recogRef.current = null;
    nativeActiveRef.current = false;
    if (!r) return;
    try {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.onstart = null;
      r.onnomatch = null;
    } catch {
      /* ignore */
    }
    try {
      r.abort?.();
    } catch {
      /* ignore */
    }
    try {
      r.stop();
    } catch {
      /* ignore */
    }
  }, [clearStartTimer]);

  const shutdownFromFatalSpeechError = useCallback(
    (code) => {
      wantListeningRef.current = false;
      clearStartTimer();
      setListening(false);
      setSoftHint(null);
      setError(code);
      closeNativeStartGate({ ok: false, reason: "fatal", code });
      disposeRecognizer();
    },
    [clearStartTimer, closeNativeStartGate, disposeRecognizer]
  );

  const scheduleStart = useCallback(
    (delayMs = 60) => {
      clearStartTimer();
      startTimerRef.current = setTimeout(() => {
        startTimerRef.current = null;
        const r = recogRef.current;
        if (!r || !wantListeningRef.current) return;
        try {
          r.start();
          devSpeechLog("recognition.start() ok");
        } catch (e) {
          const msg = String(e?.message || e || "");
          if (/already started|already running/i.test(msg)) {
            devSpeechLog("recognition start: already running, retry after stop");
            try {
              r.stop();
            } catch {
              try {
                r.abort?.();
              } catch {
                /* ignore */
              }
            }
            startTimerRef.current = setTimeout(() => {
              startTimerRef.current = null;
              if (!wantListeningRef.current) return;
              try {
                r.start();
                devSpeechLog("recognition.start() retry ok");
              } catch (e2) {
                devSpeechLog("recognition.start() retry failed", e2);
                wantListeningRef.current = false;
                setError(String(e2?.message || e2));
                setListening(false);
                nativeActiveRef.current = false;
                closeNativeStartGate({ ok: false, reason: "start-failed", message: String(e2?.message || e2) });
              }
            }, RETRY_ALREADY_STARTED_MS);
            return;
          }
          devSpeechLog("recognition.start() failed", e);
          wantListeningRef.current = false;
          setError(msg || "speech-start-failed");
          setListening(false);
          nativeActiveRef.current = false;
          closeNativeStartGate({ ok: false, reason: "start-failed", message: msg || "speech-start-failed" });
        }
      }, delayMs);
    },
    [clearStartTimer, closeNativeStartGate]
  );

  const wireRecognizer = useCallback(
    (r) => {
      r.continuous = true;
      r.interimResults = true;
      r.lang = SPEECH_RECOGNITION_LANG;
      try {
        r.maxAlternatives = 1;
      } catch {
        /* optional */
      }
      r.onstart = () => {
        nativeActiveRef.current = true;
        setListening(true);
        setError(null);
        setSoftHint(null);
        closeNativeStartGate({ ok: true });
        devSpeechLog("onstart");
      };
      r.onresult = (e) => {
        setSoftHint(null);
        const now = performance.now();
        const lastT = lastSpeechAtRef.current || now;
        const gap = now - lastT;
        if (gap > LONG_PAUSE_MS && lastSpeechAtRef.current !== 0) {
          pauseTotalRef.current += gap;
          longPauseCountRef.current += 1;
        }
        lastSpeechAtRef.current = now;

        let newFinal = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i]?.[0]?.transcript ?? "";
          if (e.results[i].isFinal) newFinal += ` ${piece}`;
        }
        if (newFinal.trim()) {
          finalRef.current = `${finalRef.current} ${newFinal}`.trim();
        }
        let liveInterim = "";
        for (let i = e.results.length - 1; i >= 0; i--) {
          if (!e.results[i].isFinal) {
            liveInterim = (e.results[i]?.[0]?.transcript ?? "").trim();
            break;
          }
        }
        interimRef.current = liveInterim;
        setInterim(liveInterim);
        const liveFull = [finalRef.current, liveInterim].filter(Boolean).join(" ").trim();
        setTranscript(liveFull);
        if (isDev) {
          const preview = liveFull.slice(0, 120);
          if (preview) devSpeechLog("onresult", preview);
        }
      };
      r.onerror = (ev) => {
        const code = ev?.error || "speech-error";
        devSpeechLog("onerror", code);
        if (code === "aborted") {
          if (manualStopRef.current) {
            devSpeechLog("onerror aborted: ignored (manual stop)");
            return;
          }
          wantListeningRef.current = false;
          clearStartTimer();
          setError("aborted");
          setListening(false);
          closeNativeStartGate({ ok: false, reason: "aborted" });
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
      r.onnomatch = () => {
        devSpeechLog("onnomatch");
      };
      r.onend = () => {
        nativeActiveRef.current = false;
        devSpeechLog("onend", { want: wantListeningRef.current });
        if (!wantListeningRef.current) {
          setListening(false);
          return;
        }
        setListening(false);
        scheduleStart(RESTART_AFTER_END_MS);
        devSpeechLog("schedule restart", RESTART_AFTER_END_MS);
      };
    },
    [scheduleStart, shutdownFromFatalSpeechError, clearStartTimer, closeNativeStartGate]
  );

  const start = useCallback(
    async (taskId = null) => {
      devSpeechLog("start() begin", { taskId, supported: Boolean(Recog) });
      if (!Recog) {
        return {
          ok: false,
          error: "Voice input is supported only in Chrome or Edge.",
        };
      }
      manualStopRef.current = false;
      stopSpeaking();
      await waitMs(120);
      await waitForSpeechSynthesisIdle(8000);
      if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
        devSpeechLog("TTS still speaking after idle wait — extra 200ms");
        await waitMs(200);
      }
      const prime = await primeMicrophoneForRecognition();
      if (!prime.ok) {
        const msg = prime.message || "Microphone permission was denied or unavailable.";
        setError(msg);
        setListening(false);
        devSpeechLog("start() aborted: mic prime failed", prime);
        return { ok: false, error: msg };
      }

      wantListeningRef.current = false;
      closeNativeStartGate({ ok: false, reason: "superseded" });
      disposeRecognizer();
      clearStartTimer();
      setError(null);
      setSoftHint(null);
      finalRef.current = "";
      interimRef.current = "";
      setInterim("");
      setTranscript("");
      activeTaskIdRef.current = taskId;
      setActiveTaskId(taskId);
      startTimeRef.current = performance.now();
      lastSpeechAtRef.current = 0;
      pauseTotalRef.current = 0;
      longPauseCountRef.current = 0;

      const nativeReady = new Promise((resolve, reject) => {
        nativeStartGateRef.current = {
          resolve: () => resolve(),
          reject: (v) => reject(v),
          timer: setTimeout(() => {
            wantListeningRef.current = false;
            clearStartTimer();
            disposeRecognizer();
            setListening(false);
            closeNativeStartGate({ ok: false, reason: "timeout" });
          }, NATIVE_START_TIMEOUT_MS),
        };
      });

      const r = new Recog();
      wireRecognizer(r);
      recogRef.current = r;
      wantListeningRef.current = true;
      scheduleStart(300);
      devSpeechLog("start() scheduled first native start");

      try {
        await nativeReady;
      } catch (reason) {
        if (reason?.reason === "timeout") {
          const msg = "Speech recognition did not start.";
          setError(msg);
          devSpeechLog("start() failed: native onstart timeout");
          return { ok: false, error: msg };
        }
        if (reason?.reason === "superseded") {
          return { ok: false, error: "Speech recognition did not start." };
        }
        if (reason?.reason === "fatal" && reason.code) {
          const msg = speechRecognitionErrorMessage(reason.code);
          devSpeechLog("start() failed: fatal before/during onstart", reason.code);
          return { ok: false, error: msg };
        }
        if (reason?.reason === "start-failed") {
          const msg = reason.message || "Speech recognition did not start.";
          return { ok: false, error: msg };
        }
        if (reason?.reason === "aborted") {
          return { ok: false, error: "Speech recognition was interrupted." };
        }
        if (reason?.reason === "stop" || reason?.reason === "unmount") {
          return { ok: false, error: "Speech recognition did not start." };
        }
        const msg = "Speech recognition did not start.";
        return { ok: false, error: msg };
      }

      return { ok: true };
    },
    [Recog, disposeRecognizer, wireRecognizer, scheduleStart, clearStartTimer, closeNativeStartGate]
  );

  const stop = useCallback(() => {
    manualStopRef.current = true;
    wantListeningRef.current = false;
    clearStartTimer();
    closeNativeStartGate({ ok: false, reason: "stop" });
    devSpeechLog("stop()");
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
    setSoftHint(null);
    const tail = (interimRef.current || "").trim();
    if (tail) {
      finalRef.current = `${finalRef.current} ${tail}`.trim();
      interimRef.current = "";
      setInterim("");
    }
    disposeRecognizer();
    const text = (finalRef.current || "").trim();
    setTranscript(text);
    const durationSec =
      startTimeRef.current > 0
        ? (performance.now() - startTimeRef.current) / 1000
        : 0;
    const sample = analyzeTranscript(text, {
      durationSec,
      pauseTotalMs: Math.round(pauseTotalRef.current),
      pauseLongCount: longPauseCountRef.current,
    });
    sample.questionId = activeTaskIdRef.current;
    setTimeout(() => {
      manualStopRef.current = false;
    }, 400);
    return sample;
  }, [clearStartTimer, disposeRecognizer, closeNativeStartGate]);

  useEffect(() => {
    devSpeechLog("hook mount", {
      supported: Boolean(Recog),
      secureContext: typeof window !== "undefined" ? window.isSecureContext : null,
    });
    return () => {
      wantListeningRef.current = false;
      manualStopRef.current = true;
      closeNativeStartGate({ ok: false, reason: "unmount" });
      disposeRecognizer();
    };
  }, [disposeRecognizer, Recog, closeNativeStartGate]);

  return {
    supported,
    listening,
    interim,
    transcript,
    error,
    softHint,
    activeTaskId,
    start,
    stop,
  };
}
