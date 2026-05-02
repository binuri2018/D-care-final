import React, { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  faceIdentify,
  faceRegisterBatch,
  faceRegisterSessionAbort,
  faceRegisterSessionFinalize,
  faceRegisterSessionFrame,
  faceRegisterSessionRename,
  faceRegisterSessionStart,
} from "../services/faceApi";
import {
  memoryGetPerson,
  memoryIdentifyVoice,
  memoryPhotoSrc,
  memoryRegisterVoice,
  memorySaveMemories,
} from "../services/memoryApi";
import { getUserMediaErrorMessage } from "../utils/getUserMediaErrorMessage";
import { concatFloat32Chunks, floatToWavBlob } from "../utils/floatToWavBlob";
import { speakReminder } from "../hooks/useVoice";

const FACE_SCAN_DURATION_MS = 10_000;
const VOICE_RECORD_DURATION_MS = 5_000;
const FACE_SAMPLE_INTERVAL_MS = 500;

/** Identify UI phases (under the primary button). */
const PHASE_FACE = "Scanning your face…";
const PHASE_VOICE = "Listening — speak for 5s…";
const PHASE_COMPLETE = "Recognition complete";
const PHASE_NO_MATCH = "No match found";

function buildGreetingLine(name, description) {
  const desc = (description || "").trim();
  let t = `Hello ${name}.`;
  if (desc) t += ` ${desc}`;
  return t;
}

function useFaceCamera() {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);

  const attachRef = useCallback(
    (node) => {
      videoRef.current = node;
      if (node && stream) {
        node.srcObject = stream;
        node.play().catch(() => {});
      }
    },
    [stream]
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser does not support camera access from this page.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      setStream(s);
    } catch (e) {
      toast.error(getUserMediaErrorMessage(e, "camera"), { duration: 10000 });
    }
  }, []);

  useEffect(() => {
    const node = videoRef.current;
    if (node && stream) {
      node.srcObject = stream;
      node.play().catch(() => {});
    }
  }, [stream]);

  const stop = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const waitForVideoReady = useCallback(
    (timeoutMs = 8000) =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          const v = videoRef.current;
          if (v && v.videoWidth > 0 && v.videoHeight > 0) {
            resolve();
            return;
          }
          if (Date.now() - t0 > timeoutMs) {
            reject(new Error("Camera did not start in time"));
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    []
  );

  const captureJpegBlob = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  }, []);

  return {
    videoRef: attachRef,
    stream,
    start,
    stop,
    streaming: !!stream,
    captureJpegBlob,
    waitForVideoReady,
  };
}

function useMicRecorder() {
  const [recording, setRecording] = useState(false);
  const activeRef = useRef(false);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const gainRef = useRef(null);
  const sampleRateRef = useRef(48000);

  /**
   * Captures mono PCM via ScriptProcessor and returns a WAV Blob (librosa-friendly, no WebM/ffmpeg).
   */
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser does not support microphone recording from this page.");
      return false;
    }
    if (!window.AudioContext && !window.webkitAudioContext) {
      toast.error("This browser does not support Web Audio recording.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      if (ctx.state === "suspended") await ctx.resume();
      sampleRateRef.current = ctx.sampleRate;
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;

      processor.onaudioprocess = (e) => {
        if (!activeRef.current) return;
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(ctx.destination);

      activeRef.current = true;
      setRecording(true);
      return true;
    } catch (e) {
      toast.error(getUserMediaErrorMessage(e, "mic"), { duration: 10000 });
      return false;
    }
  };

  const stop = async () => {
    activeRef.current = false;

    const processor = processorRef.current;
    const source = sourceRef.current;
    const gain = gainRef.current;
    const ctx = ctxRef.current;
    const stream = streamRef.current;
    const sr = sampleRateRef.current;

    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;

    try {
      if (processor) {
        processor.onaudioprocess = null;
        processor.disconnect();
      }
      if (source) source.disconnect();
      if (gain) gain.disconnect();
      if (ctx && ctx.state !== "closed") await ctx.close();
    } catch {
      /* ignore */
    }

    stream?.getTracks().forEach((t) => t.stop());
    setRecording(false);

    const pcm = concatFloat32Chunks(chunksRef.current);
    chunksRef.current = [];
    if (!pcm.length) return null;
    return floatToWavBlob(pcm, sr);
  };

  return { recording, start, stop };
}

export default function MemoryAid() {
  const [tab, setTab] = useState("identify");
  const cam = useFaceCamera();
  const mic = useMicRecorder();

  const identifiedRef = useRef(new Set());
  const [detectedList, setDetectedList] = useState([]);
  const [memoryLogPerson, setMemoryLogPerson] = useState(null);

  const [identifyBusy, setIdentifyBusy] = useState(false);
  const [identifyPhase, setIdentifyPhase] = useState(null);
  /** Shown under the identify button: face-only or voice row with confidence. */
  const [identifyBanner, setIdentifyBanner] = useState(null);

  const [registerName, setRegisterName] = useState("");
  const [registerDesc, setRegisterDesc] = useState("");
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [captures, setCaptures] = useState([]);

  const [autoIdentify, setAutoIdentify] = useState(false);
  const speakOnRecognizeRef = useRef(true);
  const [speakUi, setSpeakUi] = useState(true);

  const [regSessionId, setRegSessionId] = useState(null);
  const [registerLiveActive, setRegisterLiveActive] = useState(false);
  const [registerCaptureHint, setRegisterCaptureHint] = useState(null);
  const lastFrameAtRef = useRef(0);
  const identifyBusyRef = useRef(false);
  const identifyRunIdRef = useRef(0);

  useEffect(() => {
    speakOnRecognizeRef.current = speakUi;
  }, [speakUi]);

  const bumpDetected = useCallback(() => {
    setDetectedList(Array.from(identifiedRef.current).sort());
  }, []);

  const announceRecognized = useCallback(
    async (name, faceBanner) => {
      if (!name || identifiedRef.current.has(name)) return;
      if (faceBanner?.setBanner) {
        setIdentifyBanner({
          name,
          byFace: true,
          faceDistance: faceBanner.faceDistance,
        });
      }
      identifiedRef.current.add(name);
      bumpDetected();
      let profile;
      try {
        profile = await memoryGetPerson(name);
      } catch {
        profile = { name, description: "", photo_urls: [] };
      }
      const desc = profile?.description || "";
      const line = buildGreetingLine(name, desc);
      if (speakOnRecognizeRef.current) {
        speakReminder(line, { rate: 0.92, pitch: 1 });
      }
      setMemoryLogPerson(profile);
      toast.success(`Recognized: ${name}`, { duration: 3500 });
    },
    [bumpDetected]
  );

  const presentRecognitionComplete = useCallback(async (personOrId) => {
    const name =
      typeof personOrId === "string"
        ? personOrId.trim()
        : (personOrId && typeof personOrId === "object" && personOrId.name
            ? String(personOrId.name).trim()
            : "");
    if (!name) return;

    let profile;
    try {
      profile = await memoryGetPerson(name);
    } catch {
      profile = { name, description: "", photo_urls: [] };
    }

    setMemoryLogPerson(profile);

    const line = buildGreetingLine(name, profile?.description || "");
    if (speakOnRecognizeRef.current) {
      speakReminder(line, { rate: 0.92, pitch: 1 });
    }

    if (!identifiedRef.current.has(name)) {
      identifiedRef.current.add(name);
      bumpDetected();
    }

    toast.success(`Recognized: ${name}`, { duration: 4000 });
  }, [bumpDetected]);

  const clearIdentifySession = () => {
    identifiedRef.current = new Set();
    setDetectedList([]);
    setMemoryLogPerson(null);
    setIdentifyBanner(null);
    setIdentifyPhase(null);
    toast("History cleared");
  };

  useEffect(() => {
    if (tab !== "identify" || !cam.streaming || !autoIdentify || identifyBusy) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || identifyBusyRef.current) return;
      identifyBusyRef.current = true;
      try {
        const blob = await cam.captureJpegBlob();
        if (!blob) return;
        const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
        const r = await faceIdentify(file);
        if (cancelled) return;
        const faces = r.faces || [];
        for (const f of faces) {
          if (f?.name) {
            await announceRecognized(f.name, { setBanner: true, faceDistance: f.best_distance });
          }
        }
      } catch {
        /* ignore */
      } finally {
        identifyBusyRef.current = false;
      }
    };
    const id = setInterval(tick, 1100);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tab, cam.streaming, autoIdentify, identifyBusy, cam.captureJpegBlob, announceRecognized]);

  const runIdentifySequence = async () => {
    if (identifyBusy) return;

    const runId = ++identifyRunIdRef.current;
    setIdentifyBanner(null);
    setIdentifyBusy(true);
    setIdentifyPhase(PHASE_FACE);

    if (!cam.streaming) {
      await cam.start();
    }
    try {
      await cam.waitForVideoReady();
    } catch {
      toast.error("Camera not ready — allow camera access and try again");
      setIdentifyBusy(false);
      setIdentifyPhase(null);
      return;
    }

    let matched = false;
    let finishedNoMatch = false;

    const endMic = async () => {
      try {
        await mic.stop();
      } catch {
        /* ignore */
      }
    };

    const clearOutcomePhaseLater = () => {
      window.setTimeout(() => {
        if (identifyRunIdRef.current === runId) {
          setIdentifyPhase(null);
        }
      }, 2800);
    };

    try {
      const faceDeadline = Date.now() + FACE_SCAN_DURATION_MS;
      while (Date.now() < faceDeadline) {
        const blob = await cam.captureJpegBlob();
        if (blob) {
          const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
          const r = await faceIdentify(file);
          const names = [
            ...new Set((r.faces || []).map((f) => f?.name).filter(Boolean)),
          ];
          if (names.length) {
            const nm = names[0];
            const firstKnown = (r.faces || []).find((f) => f?.name === nm);
            const dist = firstKnown?.best_distance;
            setIdentifyBanner({ name: nm, byFace: true, faceDistance: dist });
            await presentRecognitionComplete(nm);
            matched = true;
            return;
          }
        }
        await new Promise((res) => setTimeout(res, FACE_SAMPLE_INTERVAL_MS));
      }

      setIdentifyPhase(PHASE_VOICE);
      const ok = await mic.start();
      if (!ok) {
        toast.error("Microphone not available");
        return;
      }

      await new Promise((res) => setTimeout(res, VOICE_RECORD_DURATION_MS));
      const audio = await mic.stop();
      if (!audio?.size) {
        toast.error("No audio captured");
        return;
      }

      const vr = await memoryIdentifyVoice(audio);
      if (vr.name) {
        setIdentifyBanner({
          name: vr.name,
          byVoice: true,
          voiceScore: typeof vr.score === "number" ? vr.score : null,
        });
        await presentRecognitionComplete(vr.name);
        matched = true;
      } else {
        finishedNoMatch = true;
      }
    } catch (e) {
      toast.error(e.message || "Identify failed");
    } finally {
      await endMic();
      setIdentifyBusy(false);

      if (matched) {
        setIdentifyPhase(PHASE_COMPLETE);
        clearOutcomePhaseLater();
      } else if (finishedNoMatch) {
        setIdentifyPhase(PHASE_NO_MATCH);
        clearOutcomePhaseLater();
      } else {
        if (identifyRunIdRef.current === runId) {
          setIdentifyPhase(null);
        }
      }
    }
  };

  const collectRegistrationFrames = async () => {
    if (!registerName.trim()) {
      toast.error("Enter full name first");
      return;
    }
    const blob = await cam.captureJpegBlob();
    if (!blob) {
      toast.error("Camera not ready");
      return;
    }
    setCaptures((c) => {
      const next = [...c, blob].slice(-24);
      toast.success(`${next.length} frame(s) queued`);
      return next;
    });
  };

  const submitFaceRegistration = async () => {
    if (!registerName.trim()) {
      toast.error("Enter a name");
      return;
    }
    const files = captures.map(
      (b, i) => new File([b], `cap_${i}.jpg`, { type: "image/jpeg" })
    );
    if (!files.length) {
      toast.error("Add frames or use live capture");
      return;
    }
    try {
      await faceRegisterBatch(registerName.trim(), files);
      toast.success("Face model saved");
      setCaptures([]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const finalizeRecords = async () => {
    if (!registerName.trim()) {
      toast.error("Enter full name");
      return;
    }
    try {
      await memorySaveMemories(registerName.trim(), registerDesc, extraPhotos);
      toast.success("Memories and photos saved");
      setExtraPhotos([]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const startRegisterLiveSession = async () => {
    if (!registerName.trim()) {
      toast.error("Enter full name first");
      return;
    }
    try {
      const { session_id: sid } = await faceRegisterSessionStart(registerName.trim());
      setRegSessionId(sid);
      setRegisterLiveActive(true);
      setRegisterCaptureHint({ captures: 0, max: 12 });
      await faceRegisterSessionRename(sid, registerName.trim());
      toast.success("Live capture started");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const stopRegisterLiveSession = async () => {
    setRegisterLiveActive(false);
    setRegisterCaptureHint(null);
    if (regSessionId) {
      await faceRegisterSessionAbort(regSessionId);
      setRegSessionId(null);
    }
    toast("Live capture stopped");
  };

  useEffect(() => {
    if (tab !== "register" || !registerLiveActive || !regSessionId || !cam.streaming) return undefined;
    let cancelled = false;
    const send = async () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFrameAtRef.current < 850) return;
      const blob = await cam.captureJpegBlob();
      if (!blob) return;
      const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
      try {
        const r = await faceRegisterSessionFrame(regSessionId, file);
        lastFrameAtRef.current = Date.now();
        setRegisterCaptureHint({
          captures: r.captures,
          max: r.max_images,
          face_count: r.face_count,
          committed: r.committed,
        });
        if (r.committed) {
          toast.success("Face model saved (12 embeddings)");
          setRegSessionId(null);
          setRegisterLiveActive(false);
        }
      } catch {
        /* ignore */
      }
    };
    const iv = setInterval(send, 950);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [tab, registerLiveActive, regSessionId, cam.streaming, cam.captureJpegBlob]);

  const finalizePartialRegisterSession = async () => {
    if (!regSessionId) return;
    try {
      await faceRegisterSessionFinalize(regSessionId);
      toast.success("Partial face model saved");
      setRegSessionId(null);
      setRegisterLiveActive(false);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const onVoiceRegister = async () => {
    if (!registerName.trim()) {
      toast.error("Enter full name first");
      return;
    }
    toast("Recording 5s…");
    const ok = await mic.start();
    if (!ok) return;
    await new Promise((r) => setTimeout(r, 5000));
    const blob = await mic.stop();
    if (!blob?.size) {
      toast.error("No audio captured");
      return;
    }
    try {
      await memoryRegisterVoice(registerName.trim(), blob);
      toast.success("Voice saved");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const openMemoryLog = async (person) => {
    try {
      const profile = await memoryGetPerson(person);
      setMemoryLogPerson(profile);
    } catch {
      toast.error("Could not load profile");
    }
  };

  return (
    <div className="memory-aid memory-aid-wide memory-recognition-page">
      <header className="memory-recognition-header">
        <span className="memory-recognition-icon" aria-hidden>
          🧠
        </span>
        <h1>Memory-Based Recognition (Face &amp; Voice)</h1>
      </header>

      <nav className="memory-recognition-nav" aria-label="Navigation">
        <span className="memory-recognition-nav-label">Navigation</span>
        <div className="memory-radio-row">
          <label className="memory-radio">
            <input type="radio" name="memory-mode" checked={tab === "identify"} onChange={() => setTab("identify")} />
            <span>Identify Mode</span>
          </label>
          <label className="memory-radio">
            <input type="radio" name="memory-mode" checked={tab === "register"} onChange={() => setTab("register")} />
            <span>Register New Person</span>
          </label>
        </div>
      </nav>

      {tab === "identify" && (
        <>
          <div className="identify-grid recognition-layout">
            <div className="identify-main recognition-main card-block">
              <p className="recognition-instruction">
                Click the button below — it will open your camera for <strong>10 seconds</strong> to scan your face, then
                listen for <strong>5 seconds</strong> to recognise your voice.
              </p>

              <video ref={cam.videoRef} className="memory-video recognition-video" playsInline muted />

              <button
                type="button"
                className="recognition-identify-btn"
                onClick={runIdentifySequence}
                disabled={identifyBusy || mic.recording}
              >
                <span className="recognition-identify-icon" aria-hidden>
                  🔍
                </span>
                Identify Person (Face + Voice)
              </button>

              {identifyPhase &&
                identifyPhase !== PHASE_COMPLETE &&
                identifyPhase !== PHASE_NO_MATCH && (
                  <p className="recognition-phase">{identifyPhase}</p>
                )}

              {identifyBanner?.name && (
                <>
                  <div className="recognition-success-bar" role="status">
                    <span aria-hidden>✅</span>
                    <span>
                      Identified as <strong className="recognition-success-name">{identifyBanner.name}</strong>
                    </span>
                  </div>
                  {identifyBanner.byVoice && (
                    <p className="recognition-voice-meta">
                      🎤 Voice → {identifyBanner.name}
                      {identifyBanner.voiceScore != null && (
                        <span> (conf: {Number(identifyBanner.voiceScore).toFixed(2)})</span>
                      )}
                    </p>
                  )}
                </>
              )}

              {identifyPhase === PHASE_NO_MATCH && <div className="recognition-no-match">No match found</div>}

              <details className="recognition-advanced">
                <summary>Camera &amp; options</summary>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={autoIdentify}
                    onChange={(e) => setAutoIdentify(e.target.checked)}
                    disabled={identifyBusy}
                  />
                  Continuous face check while camera on
                </label>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={speakUi}
                    onChange={(e) => setSpeakUi(e.target.checked)}
                    disabled={identifyBusy}
                  />
                  Read memory aloud when someone is recognized
                </label>
                <div className="recognition-camera-tools">
                  {!cam.streaming ? (
                    <button type="button" className="btn-secondary btn-compact" onClick={() => cam.start()} disabled={identifyBusy}>
                      Start camera only
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary btn-compact" onClick={() => cam.stop()} disabled={identifyBusy}>
                      Stop camera
                    </button>
                  )}
                </div>
              </details>
            </div>

            <aside className="identify-sidebar recognition-sidebar card-block">
              <h2 className="recognition-sidebar-title">Detected Persons</h2>
              <div className="detected-persons-panel">
                {!detectedList.length ? (
                  <p className="detected-persons-empty">No one identified yet.</p>
                ) : (
                  <ul className="detected-persons-list">
                    {detectedList.map((person) => (
                      <li key={person}>
                        <button type="button" className="btn-view-memories" onClick={() => openMemoryLog(person)}>
                          View Memories: {person}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="btn-clear-history" onClick={clearIdentifySession}>
                Clear History
              </button>
            </aside>
          </div>

          {memoryLogPerson?.name && (
            <section className="memory-log-panel card-block">
              <div className="memory-log-head">
                <h2>{memoryLogPerson.name}</h2>
                <button type="button" onClick={() => setMemoryLogPerson(null)}>
                  Close
                </button>
              </div>
              <div className="memory-log-cols">
                <div>
                  <h3>Notes</h3>
                  <p>{memoryLogPerson.description?.trim() || "—"}</p>
                </div>
                <div>
                  <h3>Photos</h3>
                  <div className="memory-gallery">
                    {(memoryLogPerson.photo_urls || []).length ? (
                      memoryLogPerson.photo_urls.map((u) => (
                        <img key={u} src={memoryPhotoSrc(u)} alt="" className="memory-thumb" />
                      ))
                    ) : (
                      <p className="muted">No photos</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {tab === "register" && (
        <section className="memory-section card-block recognition-register-block">
          <p className="recognition-instruction recognition-instruction-register">
            Add a new person: capture face samples, optionally record voice, then save notes and photos.
          </p>
          <h2>New person</h2>
          <label className="field">
            <span>Full name</span>
            <input
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              placeholder="Required"
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={registerDesc} onChange={(e) => setRegisterDesc(e.target.value)} rows={4} placeholder="" />
          </label>
          <label className="field">
            <span>Photos (saved with Finalize)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/jpg"
              multiple
              onChange={(e) => setExtraPhotos(Array.from(e.target.files || []))}
            />
          </label>

          <h2>Face</h2>
          {!registerName.trim() && <p className="warn-banner">Enter a name before capturing your face.</p>}
          <div className="memory-cam-row">
            <video ref={cam.videoRef} className="memory-video" playsInline muted />
            <div className="memory-actions">
              {!cam.streaming ? (
                <button type="button" className="btn-primary" onClick={() => cam.start()}>
                  Start camera
                </button>
              ) : (
                <button type="button" onClick={() => cam.stop()}>
                  Stop
                </button>
              )}
              <button type="button" className="btn-primary" onClick={startRegisterLiveSession} disabled={!registerName.trim()}>
                Live capture (up to 12 frames)
              </button>
              <button type="button" onClick={stopRegisterLiveSession} disabled={!registerLiveActive}>
                Stop live capture
              </button>
              {registerCaptureHint && (
                <p className="capture-hint">
                  {registerCaptureHint.captures}/{registerCaptureHint.max}
                  {registerCaptureHint.face_count != null ? ` · faces: ${registerCaptureHint.face_count}` : ""}
                </p>
              )}
              <button type="button" onClick={finalizePartialRegisterSession} disabled={!regSessionId}>
                Save partial face
              </button>
              <hr className="hr-soft" />
              <button type="button" onClick={collectRegistrationFrames} disabled={!registerName.trim()}>
                Add frame to batch
              </button>
              <button type="button" className="btn-primary" onClick={submitFaceRegistration}>
                Save face from batch ({captures.length})
              </button>
            </div>
          </div>

          <h2>Voice</h2>
          <button
            type="button"
            className="btn-primary"
            onClick={onVoiceRegister}
            disabled={mic.recording || !registerName.trim()}
          >
            {mic.recording ? "Recording…" : "Record voice (5s)"}
          </button>

          <h2>Finalize</h2>
          <button type="button" className="btn-primary" onClick={finalizeRecords} disabled={!registerName.trim()}>
            Save notes &amp; photos
          </button>
        </section>
      )}
    </div>
  );
}
