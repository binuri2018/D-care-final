import React, { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  analyzeFrame,
  createLiveSession,
  deleteLiveSession,
  fetchAlertPreview,
  fetchDementiaActionHealth,
  fetchDementiaIncidents,
  postLiveFrame,
  simulateRisk,
} from "../services/dementiaActionApi";
import { getUserMediaErrorMessage } from "../utils/getUserMediaErrorMessage";
import { drawPoseOverlay } from "../utils/poseOverlay";

const LS_ALERTS = "dc_console_alerts_enabled";

function countVisibleKeypoints(kpts) {
  if (!Array.isArray(kpts) || !kpts.length) return 0;
  return kpts.filter(
    (p) => p && p.length >= 2 && (Math.abs(p[0]) > 1e-5 || Math.abs(p[1]) > 1e-5)
  ).length;
}

function centerFromKeypoints(kpts) {
  const n = countVisibleKeypoints(kpts);
  if (!n) return [0.5, 0.5];
  let sx = 0;
  let sy = 0;
  for (const p of kpts) {
    if (!p || p.length < 2) continue;
    if (Math.abs(p[0]) < 1e-5 && Math.abs(p[1]) < 1e-5) continue;
    sx += p[0];
    sy += p[1];
  }
  return [sx / n, sy / n];
}

function postureLabel(visible, kpts) {
  if (visible < 8) return "Uncertain posture";
  if (!kpts || kpts.length < 17) return "Uncertain posture";
  const ys = kpts.map((p) => (p && p[1] !== undefined ? p[1] : 0));
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const spread = ymax - ymin;
  if (spread < 0.14) return "Lying";
  const hipY = ((kpts[11]?.[1] || 0) + (kpts[12]?.[1] || 0)) / 2;
  const shoulderY = ((kpts[5]?.[1] || 0) + (kpts[6]?.[1] || 0)) / 2;
  const ratio = spread > 1e-6 ? (hipY - shoulderY) / spread : 0;
  if (ratio > 0.48) return "Sitting";
  return "Standing";
}

/**
 * Action recognition console — aligned with dementia care monitoring prototype.
 */
export default function DementiaAction() {
  const [tab, setTab] = useState("live");
  const [health, setHealth] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [apiErr, setApiErr] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [monitorExitZone, setMonitorExitZone] = useState(true);
  const [edgeThreshold, setEdgeThreshold] = useState(0.15);

  const [lastFrame, setLastFrame] = useState(null);
  const [liveError, setLiveError] = useState("");
  const [riskSnap, setRiskSnap] = useState(null);

  const [alertsEnabled, setAlertsEnabled] = useState(
    () => localStorage.getItem(LS_ALERTS) === "1"
  );

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const sessionIdRef = useRef(null);
  const shellRef = useRef(null);
  const overlayRef = useRef(null);
  const historyRef = useRef([]);
  const lastRiskAtRef = useRef(0);
  const modelWarnedRef = useRef(false);
  const analyzeTimerRef = useRef(null);
  const uploadVideoRef = useRef(null);

  const refreshIncidents = useCallback(async () => {
    try {
      const inc = await fetchDementiaIncidents(40);
      setIncidents(inc.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetchDementiaActionHealth();
        if (!cancelled) {
          setHealth(h);
          setApiErr("");
        }
      } catch (e) {
        if (!cancelled) setApiErr(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshIncidents();
  }, [tab, refreshIncidents]);

  const stopCamera = useCallback(() => {
    if (analyzeTimerRef.current) {
      clearInterval(analyzeTimerRef.current);
      analyzeTimerRef.current = null;
    }
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) {
      deleteLiveSession(sid).catch(() => {});
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const captureBlob = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    });
  }, []);

  const pushHistory = useCallback((center, action, confidence) => {
    const now = Date.now() / 1000;
    historyRef.current.push({
      timestamp: now,
      center,
      action: action || "Unknown",
      confidence: confidence ?? 0,
    });
    while (historyRef.current.length > 40) historyRef.current.shift();
  }, []);

  const pollRisk = useCallback(async () => {
    const now = Date.now() / 1000;
    if (now - lastRiskAtRef.current < 1.2) return;
    lastRiskAtRef.current = now;
    if (historyRef.current.length < 2) return;
    try {
      const out = await simulateRisk({
        entries: historyRef.current.map((e) => ({ ...e, center: [...e.center] })),
        now,
        use_exit_zone: monitorExitZone,
        edge: edgeThreshold,
      });
      setRiskSnap(out);
    } catch {
      /* non-fatal */
    }
  }, [monitorExitZone, edgeThreshold]);

  const processFrameBlob = useCallback(
    async (blob, opts = {}) => {
      if (!blob) return;
      const sid = opts.sessionId ?? sessionIdRef.current;
      try {
        let data;
        if (sid) {
          const sendLive = (sessionId) =>
            postLiveFrame(blob, {
              sessionId,
              useExitZone: monitorExitZone,
              edge: edgeThreshold,
            });
          try {
            data = await sendLive(sid);
          } catch (err) {
            const code = err.statusCode;
            const text = err.message || String(err);
            const sessionLost =
              code === 404 ||
              /unknown or expired session|session_id/i.test(text);
            if (sessionLost) {
              const created = await createLiveSession();
              const newSid = created?.session_id;
              if (!newSid) throw err;
              sessionIdRef.current = newSid;
              data = await sendLive(newSid);
            } else {
              throw err;
            }
          }
          setLiveError("");
          setLastFrame(data);
          setRiskSnap(data.risk || null);
          if (data.incident_saved) {
            const row = data.incident_saved;
            const label = row.BehaviorType || row.behavior_type || "event";
            toast.success(`Incident saved on server: ${label}`, { duration: 5500 });
            if (data.caregiver_email_dispatch) {
              const d = data.caregiver_email_dispatch;
              if (d.sent) {
                toast.success("Caregiver email sent.", { duration: 3500 });
              } else if (d.reason) {
                toast(`Email not sent: ${d.reason}`, { duration: 6000 });
              }
            }
            refreshIncidents();
          }
        } else {
          data = await analyzeFrame(blob);
          setLiveError("");
          setLastFrame(data);
          const kpts = data.keypoints_normalized;
          const vis = countVisibleKeypoints(kpts);
          const action = data.action || "Unknown";
          const conf = data.confidence ?? 0;
          const center = centerFromKeypoints(kpts);
          if (vis >= 6 && action !== "Unknown") {
            pushHistory(center, action, conf);
            await pollRisk();
          }
        }
      } catch (e) {
        const msg = e.message || String(e);
        setLastFrame(null);
        const isModels =
          msg.includes("503") ||
          (msg.includes("not found") && !/unknown or expired session/i.test(msg)) ||
          msg.includes("LSTM");
        if (isModels) {
          setLiveError("models");
          if (!modelWarnedRef.current) {
            modelWarnedRef.current = true;
            toast.error("Pose models missing on server — see model folder in health info.", {
              duration: 6000,
            });
          }
        } else {
          setLiveError("network");
        }
      }
    },
    [monitorExitZone, edgeThreshold, pollRisk, pushHistory, refreshIncidents]
  );

  useEffect(() => {
    if (!cameraOn) return undefined;
    analyzeTimerRef.current = setInterval(async () => {
      const blob = await captureBlob();
      await processFrameBlob(blob);
    }, 450);
    return () => {
      if (analyzeTimerRef.current) {
        clearInterval(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    };
  }, [cameraOn, captureBlob, processFrameBlob]);

  /** CV-style HUD: skeleton + box + labels (matches integrated pose pipeline). */
  useEffect(() => {
    const shell = shellRef.current;
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!shell || !video || !canvas) return undefined;

    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      if (!w || !h) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (tab !== "live" || !cameraOn || !video.videoWidth) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      const kpts = lastFrame?.keypoints_normalized;
      const kconf = lastFrame?.keypoint_confidences;
      const vis = countVisibleKeypoints(kpts);
      const srvVis =
        lastFrame?.pose_visible_keypoints != null
          ? Number(lastFrame.pose_visible_keypoints)
          : lastFrame?.pose_quality?.visible_count != null
            ? Number(lastFrame.pose_quality.visible_count)
            : vis;
      const act = lastFrame?.action || "Unknown";
      const cnf = lastFrame?.confidence ?? 0;
      const post = postureLabel(vis, kpts);

      let stateLine;
      if (liveError === "models") stateLine = "State: Models missing";
      else if (liveError === "network") stateLine = "State: Offline";
      else if (srvVis < 6) stateLine = "State: Uncertain";
      else if (riskSnap?.risk === "High") stateLine = "State: Elevated risk";
      else if (act !== "Unknown") stateLine = "State: Tracking";
      else stateLine = "State: Uncertain";

      let greenLine;
      if (srvVis < 6) greenLine = "—";
      else if (act && act !== "Unknown") greenLine = `${act} (${Number(cnf).toFixed(2)})`;
      else {
        const g = lastFrame?.geometry?.posture;
        const gc = Number(lastFrame?.geometry?.confidence ?? cnf);
        if (g && g !== "Uncertain posture") {
          const label = g === "Lying" ? "Lying Down" : g;
          greenLine = `${label} (${gc.toFixed(2)})`;
        } else {
          greenLine = `${post} (${gc.toFixed(2)})`;
        }
      }

      drawPoseOverlay(ctx, video, {
        keypointsNormalized: kpts,
        keypointConfidences: kconf,
        stateText: stateLine,
        actionText: greenLine,
        targetLabel: "Target ID 1",
        insideBoxText: "Memory Aid · live pose feed",
      });
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(shell);
    const onVid = () => paint();
    video.addEventListener("loadedmetadata", onVid);
    video.addEventListener("playing", onVid);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", onVid);
      video.removeEventListener("playing", onVid);
    };
  }, [lastFrame, cameraOn, liveError, riskSnap, tab]);

  const startCamera = async () => {
    setLiveError("");
    modelWarnedRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera not available in this browser.");
      return;
    }
    let sid = null;
    try {
      const created = await createLiveSession();
      sid = created.session_id;
      sessionIdRef.current = sid;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const node = videoRef.current;
      if (node) {
        node.srcObject = stream;
        await node.play();
      }
      setCameraOn(true);
    } catch (e) {
      sessionIdRef.current = null;
      if (sid) await deleteLiveSession(sid).catch(() => {});
      toast.error(getUserMediaErrorMessage(e, "camera"), { duration: 8000 });
    }
  };

  const clearLocalTest = () => {
    historyRef.current = [];
    setRiskSnap(null);
    setLastFrame(null);
    lastRiskAtRef.current = 0;
    toast.success("Cleared on-console history.", { duration: 2000 });
  };

  const toggleAlerts = (on) => {
    setAlertsEnabled(on);
    localStorage.setItem(LS_ALERTS, on ? "1" : "0");
  };

  const testAlert = async () => {
    if (!alertsEnabled) {
      toast("Enable alerts first", { icon: "ℹ️" });
      return;
    }
    try {
      const prev = await fetchAlertPreview();
      if (prev.demo) {
        toast("Using sample alert text (no captures on disk yet). You should still see a notification.", {
          duration: 4500,
        });
      }
      if (!prev.subject && !prev.body) {
        toast.error("Server returned empty alert preview.");
        return;
      }
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
      if (Notification.permission === "denied") {
        toast.error(
          "Notifications are blocked for this site. Allow them in the browser address bar or site settings, then try again.",
          { duration: 8000 }
        );
        return;
      }
      if (Notification.permission === "granted") {
        new Notification(prev.subject || "Dementia Care", { body: prev.body || "" });
        toast.success("Test notification shown in your system.");
      } else {
        toast("Notification permission was not granted.", { duration: 5000 });
      }
    } catch (e) {
      toast.error(e.message || String(e));
    }
  };

  const onUploadVideo = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/*,image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      if (f.type.startsWith("image/")) {
        const prevSid = sessionIdRef.current;
        try {
          const created = await createLiveSession();
          const sid = created.session_id;
          if (!sid) throw new Error("no session_id");
          sessionIdRef.current = sid;
          await processFrameBlob(f);
        } finally {
          if (sessionIdRef.current) {
            await deleteLiveSession(sessionIdRef.current).catch(() => {});
          }
          sessionIdRef.current = prevSid;
        }
        toast.success("Image analyzed.", { duration: 2000 });
        return;
      }
      const url = URL.createObjectURL(f);
      const v = uploadVideoRef.current;
      if (!v) {
        URL.revokeObjectURL(url);
        return;
      }
      v.src = url;
      v.muted = true;
      await v.play().catch(() => {});
      const prevSid = sessionIdRef.current;
      try {
        const created = await createLiveSession();
        const sid = created.session_id;
        if (!sid) throw new Error("no session_id");
        sessionIdRef.current = sid;
      } catch {
        URL.revokeObjectURL(url);
        toast.error("Could not start server live session.", { duration: 4000 });
        return;
      }
      let n = 0;
      const iv = setInterval(async () => {
        if (!v.videoWidth || v.paused || v.ended || n >= 90) {
          clearInterval(iv);
          URL.revokeObjectURL(url);
          if (sessionIdRef.current) await deleteLiveSession(sessionIdRef.current).catch(() => {});
          sessionIdRef.current = prevSid;
          toast.success(`Processed ${n} video frames.`, { duration: 2500 });
          return;
        }
        n += 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(v.videoWidth, 640);
        canvas.height = Math.min(v.videoHeight, 480);
        canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res) =>
          canvas.toBlob((b) => res(b), "image/jpeg", 0.82)
        );
        await processFrameBlob(blob);
      }, 480);
    };
    inp.click();
  };

  const kpts = lastFrame?.keypoints_normalized;
  const vis = countVisibleKeypoints(kpts);
  const poseVisibleServer =
    lastFrame?.pose_visible_keypoints != null
      ? Number(lastFrame.pose_visible_keypoints)
      : lastFrame?.pose_quality?.visible_count != null
        ? Number(lastFrame.pose_quality.visible_count)
        : null;
  const poseVisible = poseVisibleServer != null && !Number.isNaN(poseVisibleServer) ? poseVisibleServer : vis;
  const action = lastFrame?.action || "Unknown";
  const conf = lastFrame?.confidence ?? 0;
  const posture = postureLabel(vis, kpts);
  const videoState =
    !cameraOn && tab === "live"
      ? "Camera idle"
      : liveError === "models"
        ? "State: models not loaded on server"
        : liveError === "network"
          ? "State: could not reach analysis API"
          : poseVisible < 6
            ? "State: No reliable full-body pose"
            : `State: ${action}`;

  const behaviorLine =
    riskSnap?.behavior_type && riskSnap?.risk !== "Normal"
      ? `${riskSnap.risk} · ${riskSnap.behavior_type}`
      : posture === "Uncertain posture"
        ? "No reliable f…"
        : riskSnap?.behavior_type || "Observation";

  const logLine = [
    `${videoState.replace(/^State: /, "")}`,
    `Posture ${posture} (${conf.toFixed(2)})`,
    `Motion ${(Number(riskSnap?.walking_density) || 0).toFixed(2)} density`,
    `Server pose_visible_keypoints ${poseVisible}/17 (conf>0.25)`,
    `LSTM ${action} (${conf.toFixed(2)})`,
    `Lying ${Math.round(riskSnap?.lying_duration ?? 0)}s`,
    `Sit-stand ${riskSnap?.sit_stand_repetition_count ?? 0}`,
    `Turns ${riskSnap?.direction_change_count ?? 0}`,
    `Exit-zone ${Math.round(riskSnap?.exit_zone_time ?? 0)}s`,
    `Signals: ${(riskSnap?.risk_signals || []).join(", ") || "none"}`,
  ].join(" | ");

  return (
    <div className="dc-console">
      <header className="dc-hero">
        <h1 className="dc-title">Action recognition and behavior capture</h1>
        <p className="dc-lead">
          Abnormal-focused monitoring: each live camera session runs on the server with its own LSTM
          sequence buffer, temporal risk analysis, pose-quality gate, and time-based confirmation
          before <code className="inline-code">save_action_incident</code> writes clips and metadata.
        </p>
      </header>

      <div className="dc-callout">
        <strong>Capture gate</strong> — High-risk alerts require a reliable full-body pose, time
        confirmation, and stable behavior labels. Mundane standing or sitting with good pose does
        not populate the abnormal capture list by itself.
      </div>

      {apiErr && (
        <div className="dc-banner dc-banner-warn">
          API unreachable: {apiErr} — check backend and <code className="inline-code">REACT_APP_BACKEND_URL</code>.
        </div>
      )}

      {health && (
        <p className="dc-health-hint">
          Storage: <code className="inline-code">{health.incident_dir}</code> · Models:{" "}
          <code className="inline-code">{health.model_root}</code>
          {" "}
          · Pose: <code className="inline-code">YOLOv8-pose + LSTM</code> on server (
          <code className="inline-code">/live/frame</code>, <code className="inline-code">/analyze-frame</code>)
          {health.caregiver_email_configured != null && (
            <>
              {" "}
              · Caregiver email:{" "}
              {health.caregiver_email_configured ? (
                <span className="dc-health-ok">configured</span>
              ) : (
                <span className="dc-health-warn">not set (optional)</span>
              )}
            </>
          )}
        </p>
      )}

      <div className="dc-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "live"}
          className={`dc-tab ${tab === "live" ? "dc-tab-active" : ""}`}
          onClick={() => setTab("live")}
        >
          Live camera
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "upload"}
          className={`dc-tab ${tab === "upload" ? "dc-tab-active" : ""}`}
          onClick={() => setTab("upload")}
        >
          Video upload
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "captures"}
          className={`dc-tab ${tab === "captures" ? "dc-tab-active" : ""}`}
          onClick={() => setTab("captures")}
        >
          Abnormal captures
        </button>
      </div>

      {tab === "live" && (
        <>
          <div className="dc-toolbar">
            <button type="button" className="btn-primary" onClick={startCamera} disabled={cameraOn}>
              Start camera
            </button>
            <button type="button" className="btn-secondary" onClick={stopCamera} disabled={!cameraOn}>
              Stop camera
            </button>
            <label className="dc-check">
              <input
                type="checkbox"
                checked={monitorExitZone}
                onChange={(e) => setMonitorExitZone(e.target.checked)}
              />
              Monitor exit-zone
            </label>
            <button type="button" className="btn-secondary" onClick={clearLocalTest}>
              Clear test history
            </button>
          </div>

          <div className="dc-slider-row">
            <label htmlFor="dc-edge">Exit-zone edge threshold</label>
            <input
              id="dc-edge"
              type="range"
              min="0.05"
              max="0.35"
              step="0.01"
              value={edgeThreshold}
              onChange={(e) => setEdgeThreshold(Number(e.target.value))}
            />
            <span className="dc-slider-val">{edgeThreshold.toFixed(2)}</span>
          </div>

          <div className="dc-video-shell" ref={shellRef}>
            <video ref={videoRef} className="dc-video" playsInline muted />
            <canvas
              ref={overlayRef}
              className={`dc-pose-overlay ${cameraOn ? "dc-pose-overlay--on" : "dc-pose-overlay--off"}`}
              aria-hidden
            />
            {!cameraOn && <div className="dc-video-placeholder">Camera off</div>}
            <div className="dc-video-caption">{videoState}</div>
          </div>
        </>
      )}

      {tab === "upload" && (
        <div className="dc-upload-panel">
          <p className="dc-lead small">
            Upload a short video or a single image. Videos are sampled in real time in the browser
            and each frame is sent to the analysis API (use modest clips to avoid overload).
          </p>
          <button type="button" className="btn-primary" onClick={onUploadVideo}>
            Choose file…
          </button>
          <video
            ref={uploadVideoRef}
            className="dc-upload-video"
            playsInline
            muted
            aria-hidden
          />
        </div>
      )}

      {tab === "captures" && (
        <div className="dc-captures">
          <button type="button" className="btn-secondary dc-refresh" onClick={refreshIncidents}>
            Refresh list
          </button>
          {incidents.length === 0 ? (
            <p className="dc-muted">No confirmed abnormal captures yet.</p>
          ) : (
            <ul className="dc-capture-list">
              {incidents.map((row) => (
                <li key={row.Id} className="dc-capture-card">
                  <div className="dc-capture-title">
                    {row.BehaviorType}{" "}
                    <span className="dc-badge">{row.Severity}</span>
                  </div>
                  <div className="dc-capture-meta">
                    {row.Time} — {row.Reason}
                    {row.Metrics && row.Metrics.pose_visible_keypoints != null && (
                      <>
                        {" "}
                        · pose_visible_keypoints {row.Metrics.pose_visible_keypoints}/17
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="dc-metrics">
        <div className="dc-metric-card">
          <div className="dc-metric-label">LSTM action</div>
          <div className="dc-metric-value">{action}</div>
          <div className="dc-metric-foot">
            <span className="dc-pill">↑ {conf.toFixed(2)} confidence</span>
          </div>
        </div>
        <div className="dc-metric-card">
          <div className="dc-metric-label">Behavior / posture</div>
          <div className="dc-metric-value dc-metric-clamp">{behaviorLine}</div>
          <div className="dc-metric-foot">
            <span className="dc-pill dc-pill-neutral">{riskSnap?.risk || "Normal"}</span>
          </div>
        </div>
        <div className="dc-metric-card">
          <div className="dc-metric-label">Pose visibility</div>
          <div className="dc-metric-value">{poseVisible}</div>
          <div className="dc-metric-foot">
            <span className="dc-pill">
              ↑ {poseVisible}/17 ·{" "}
              <code className="inline-code">pose_visible_keypoints</code> (server)
            </span>
          </div>
        </div>
        <div className="dc-metric-card">
          <div className="dc-metric-label">Capture status</div>
          <div className="dc-metric-value dc-metric-sm">Watching</div>
          <div className="dc-metric-foot">
            <span className="dc-pill dc-pill-ok">
              {lastFrame?.incident_saved
                ? "Incident saved — see Captures tab"
                : riskSnap?.risk === "High"
                  ? "High risk flagged — server confirmation + gate"
                  : "No abnormal capture without server incident save"}
            </span>
          </div>
        </div>
      </div>

      <div className="dc-banner">
        {poseVisible < 6
          ? "No person with a reliable full-body pose was detected."
          : riskSnap?.risk === "High"
            ? `Elevated risk: ${riskSnap.behavior_type} — ${riskSnap.reason}`
            : "Pose OK — monitoring continues. Normal activity is not logged as an abnormal capture."}
      </div>

      <pre className="dc-log" aria-label="Technical log">
        {logLine}
      </pre>

      <section className="dc-alerts">
        <h2 className="dc-alerts-title">Caregiver alerts</h2>
        <div className="dc-alerts-row">
          <label className="dc-check">
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={(e) => toggleAlerts(e.target.checked)}
            />
            Enable alerts
          </label>
          <button type="button" className="btn-secondary" onClick={testAlert}>
            Test alert
          </button>
          <span className="dc-muted inline-hint">
            Uses browser notifications when allowed. Server email: set{" "}
            <code className="inline-code">DEMENTIA_CAREGIVER_EMAIL</code> (or{" "}
            <code className="inline-code">CAREGIVER_ALERT_EMAIL</code>) and{" "}
            <code className="inline-code">SMTP_*</code> — sent automatically when an incident is saved; pose
            lines are included in the message body.
          </span>
        </div>
      </section>
    </div>
  );
}
