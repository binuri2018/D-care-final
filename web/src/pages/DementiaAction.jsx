import React, { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  analyzeFrame,
  createLiveSession,
  deleteLiveSession,
  fetchAlertPreview,
  fetchDementiaActionHealth,
  fetchDementiaAlerts,
  fetchDementiaEvents,
  fetchDementiaIncidents,
  postBrowserAlertAck,
  postLiveFrame,
  simulateRisk,
} from "../services/dementiaActionApi";
import { getUserMediaErrorMessage } from "../utils/getUserMediaErrorMessage";
import { drawPoseOverlay } from "../utils/poseOverlay";

const LS_ALERTS = "dc_console_alerts_enabled";
const ASSET_BASE = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_LOG_LINES = 500;
const ACCEPT_UPLOAD = "video/mp4,video/quicktime,video/x-msvideo,video/webm,video/*,image/jpeg,image/png,image/*";

/** Same pipe-separated technical line as the live camera footer (pose + LSTM + risk metrics). */
/**
 * Seek video for frame extraction. Listener must be registered before mutating currentTime
 * (otherwise seeked can fire synchronously and be missed). No seeked when time unchanged.
 */
function waitForVideoSeek(video, targetTime) {
  const dur = Number(video.duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return Promise.reject(new Error("invalid video duration"));
  }
  const t = Math.min(Math.max(0, targetTime), Math.max(0, dur - 0.001));
  if (Math.abs(video.currentTime - t) < 0.02) {
    return new Promise((r) => {
      requestAnimationFrame(() => r());
    });
  }
  return new Promise((resolve, reject) => {
    const to = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("seek timeout — try a shorter clip or MP4 (H.264)"));
    }, 15000);
    const onSeeked = () => {
      window.clearTimeout(to);
      video.removeEventListener("seeked", onSeeked);
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = t;
    } catch (e) {
      window.clearTimeout(to);
      video.removeEventListener("seeked", onSeeked);
      reject(e);
    }
  });
}

function buildTechnicalLogLine({ tab, cameraOn, liveError, lastFrame, riskSnap: riskFallback }) {
  if (!lastFrame) {
    if (!cameraOn && tab === "live") return "Camera idle | —";
    if (tab === "upload")
      return "Run Analyze on a clip to append per-frame detection logs here (same format as live camera).";
    return "—";
  }
  const kpts = lastFrame.keypoints_normalized;
  const vis = countVisibleKeypoints(kpts);
  const poseVisibleServer =
    lastFrame.pose_visible_keypoints != null
      ? Number(lastFrame.pose_visible_keypoints)
      : lastFrame.pose_quality?.visible_count != null
        ? Number(lastFrame.pose_quality.visible_count)
        : null;
  const poseVisible =
    poseVisibleServer != null && !Number.isNaN(poseVisibleServer) ? poseVisibleServer : vis;
  const action = lastFrame.action || "Unknown";
  const conf = lastFrame.confidence ?? 0;
  const posture = postureLabel(vis, kpts);
  const riskSnap = lastFrame.risk ?? riskFallback;

  const videoState =
    !cameraOn && tab === "live"
      ? "Camera idle"
      : liveError === "models"
        ? "State: models not loaded on server"
        : liveError === "network"
          ? "State: could not reach analysis API"
          : poseVisible < 6
            ? "State: No reliable full-body pose"
            : riskSnap?.risk === "High" || riskSnap?.risk === "Medium"
              ? `State: ${riskSnap.risk} — ${riskSnap.behavior_type || ""}`
              : `State: ${action}`;

  return [
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
}

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

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
  const [riskEvents, setRiskEvents] = useState([]);
  const [alertLog, setAlertLog] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [soundManual, setSoundManual] = useState(false);
  const [apiErr, setApiErr] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [monitorExitZone, setMonitorExitZone] = useState(true);
  const [edgeThreshold, setEdgeThreshold] = useState(0.15);
  const [uploadFps, setUploadFps] = useState(15);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadObjectUrl, setUploadObjectUrl] = useState(null);
  const [uploadVideoReady, setUploadVideoReady] = useState(false);
  const [uploadAnalyzing, setUploadAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadDropActive, setUploadDropActive] = useState(false);
  const [uploadDetectionLogs, setUploadDetectionLogs] = useState([]);

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
  const uploadShellRef = useRef(null);
  const uploadOverlayRef = useRef(null);
  const uploadImgRef = useRef(null);
  const uploadLogPreRef = useRef(null);
  const historyRef = useRef([]);
  const lastRiskAtRef = useRef(0);
  const modelWarnedRef = useRef(false);
  const analyzeTimerRef = useRef(null);
  const uploadVideoRef = useRef(null);
  const lastBrowserAlertIdRef = useRef(null);

  const playAlertBeep = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 1000;
      const now = ctx.currentTime;
      const peak = 0.38;
      const dur = 0.32;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.02);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
      o.start(now);
      o.stop(now + dur + 0.02);
      setTimeout(() => {
        try {
          ctx.close();
        } catch {
          /* ignore */
        }
      }, 450);
      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshIncidents = useCallback(async () => {
    try {
      const inc = await fetchDementiaIncidents(40);
      setIncidents(inc.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const [ev, al] = await Promise.all([fetchDementiaEvents(), fetchDementiaAlerts()]);
      setRiskEvents(ev.data || []);
      setAlertLog(al.data || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshLogs();
    const t = setInterval(refreshLogs, 4000);
    return () => clearInterval(t);
  }, [refreshLogs]);

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

  /* Do not revoke blob URLs in an effect cleanup tied to uploadObjectUrl — React 18 Strict Mode
   * runs cleanup on a simulated unmount and revokes the URL while state/src still point at it
   * (net::ERR_FILE_NOT_FOUND). Revoke only when replacing or clearing the file (below). */

  const clearUploadSelection = useCallback(() => {
    if (uploadObjectUrl) URL.revokeObjectURL(uploadObjectUrl);
    setUploadObjectUrl(null);
    setUploadFile(null);
    setUploadVideoReady(false);
    setUploadProgress(null);
    setUploadDetectionLogs([]);
    const v = uploadVideoRef.current;
    if (v) {
      v.removeAttribute("src");
      v.load();
    }
    const img = uploadImgRef.current;
    if (img) img.removeAttribute("src");
    setLastFrame(null);
    setRiskSnap(null);
  }, [uploadObjectUrl]);

  const assignUploadFile = useCallback(
    (file) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error("File exceeds 200 MB limit.", { duration: 4000 });
        return;
      }
      if (uploadObjectUrl) URL.revokeObjectURL(uploadObjectUrl);
      const url = URL.createObjectURL(file);
      setUploadObjectUrl(url);
      setUploadFile(file);
      setUploadVideoReady(false);
      setUploadDetectionLogs([]);
      setLastFrame(null);
      setRiskSnap(null);
      if (file.type.startsWith("video/")) {
        const img = uploadImgRef.current;
        if (img) img.removeAttribute("src");
        /* Video <video> mounts only after setUploadFile commits; src is bound via JSX + onLoadedMetadata. */
      } else if (file.type.startsWith("image/")) {
        const v = uploadVideoRef.current;
        if (v) {
          v.removeAttribute("src");
          v.load();
        }
        const img = uploadImgRef.current;
        if (img) img.src = url;
        setUploadVideoReady(false);
      }
    },
    [uploadObjectUrl]
  );

  const openUploadPicker = useCallback(() => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ACCEPT_UPLOAD;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (f) assignUploadFile(f);
    };
    inp.click();
  }, [assignUploadFile]);

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
      if (!blob) return undefined;
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
              if (opts.ephemeralSession) {
                throw err;
              }
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
            const iid = row.Id;
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
            refreshLogs();
            if (alertsEnabled && iid && lastBrowserAlertIdRef.current !== iid) {
              lastBrowserAlertIdRef.current = iid;
              const subject = `Dementia Care Alert — ${row.Severity}: ${label}`;
              const bodyText = row.Reason || row.reason || "";
              let browserOk = false;
              if (Notification.permission === "granted") {
                try {
                  new Notification(subject, { body: bodyText, tag: iid });
                  browserOk = true;
                } catch {
                  /* ignore */
                }
              }
              const played = playAlertBeep();
              setSoundManual(!played);
              postBrowserAlertAck({
                incidentId: iid,
                behavior: row.BehaviorType || "",
                severity: row.Severity || "",
                ok: browserOk,
              })
                .then(() => refreshLogs())
                .catch(() => {});
            }
          }
          return data;
        }
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
        return data;
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
        return undefined;
      }
    },
    [monitorExitZone, edgeThreshold, pollRisk, pushHistory, refreshIncidents, refreshLogs, alertsEnabled, playAlertBeep]
  );

  const analyzeUploadedImage = useCallback(async () => {
    if (!uploadFile?.type.startsWith("image/")) return;
    setLiveError("");
    setUploadAnalyzing(true);
    setUploadProgress({ current: 0, total: 1 });
    setUploadDetectionLogs([]);
    try {
      let uploadSid = null;
      try {
        const created = await createLiveSession();
        uploadSid = created?.session_id;
        if (!uploadSid) throw new Error("no session_id");
        const imgData = await processFrameBlob(uploadFile, {
          sessionId: uploadSid,
          ephemeralSession: true,
        });
        if (imgData) {
          const line = buildTechnicalLogLine({
            tab: "upload",
            cameraOn: false,
            liveError: "",
            lastFrame: imgData,
            riskSnap: imgData.risk,
          });
          setUploadDetectionLogs([`[image 1/1] ${line}`]);
        }
      } finally {
        if (uploadSid) await deleteLiveSession(uploadSid).catch(() => {});
      }
      setUploadProgress({ current: 1, total: 1 });
      toast.success("Image analyzed.", { duration: 2000 });
    } catch (e) {
      toast.error(e.message || String(e));
    } finally {
      setUploadAnalyzing(false);
      setUploadProgress(null);
    }
  }, [uploadFile, processFrameBlob]);

  const analyzeUploadedVideo = useCallback(async () => {
    if (!uploadFile?.type.startsWith("video/")) {
      toast.error("Choose a video file first.");
      return;
    }
    const v = uploadVideoRef.current;
    if (!v) {
      toast.error("Video preview is not ready yet — wait for the thumbnail to appear, then try again.");
      return;
    }
    await new Promise((r) => {
      if (v.readyState >= 1) r();
      else v.addEventListener("loadedmetadata", () => r(), { once: true });
    });
    if (!v.videoWidth) {
      toast.error("Video not ready — try MP4 / H.264.");
      return;
    }
    const duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error("Could not read video duration.");
      return;
    }
    const fps = Math.max(5, Math.min(30, uploadFps));
    const total = Math.min(Math.ceil(duration * fps), 1500);
    let sid = null;
    setLiveError("");
    setUploadAnalyzing(true);
    setUploadProgress({ current: 0, total });
    setUploadDetectionLogs([]);
    modelWarnedRef.current = false;
    try {
      const created = await createLiveSession();
      sid = created?.session_id;
      if (!sid) throw new Error("no session_id");
      for (let i = 0; i < total; i++) {
        const t = total <= 1 ? 0 : (i / (total - 1)) * Math.max(duration - 0.05, 0);
        await waitForVideoSeek(v, t);
        const canvas = document.createElement("canvas");
        const maxW = 640;
        const sc = v.videoWidth > maxW ? maxW / v.videoWidth : 1;
        canvas.width = Math.round(v.videoWidth * sc);
        canvas.height = Math.round(v.videoHeight * sc);
        if (!canvas.width || !canvas.height) {
          throw new Error("Could not decode video frame size");
        }
        canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res) =>
          canvas.toBlob((b) => res(b), "image/jpeg", 0.82)
        );
        if (!blob) {
          throw new Error("Could not encode frame as JPEG");
        }
        const frameData = await processFrameBlob(blob, { sessionId: sid, ephemeralSession: true });
        if (frameData) {
          const line = buildTechnicalLogLine({
            tab: "upload",
            cameraOn: false,
            liveError: "",
            lastFrame: frameData,
            riskSnap: frameData.risk,
          });
          setUploadDetectionLogs((prev) =>
            [...prev, `[f ${i + 1}/${total}] ${line}`].slice(-MAX_UPLOAD_LOG_LINES)
          );
        }
        setUploadProgress({ current: i + 1, total });
      }
      toast.success(`Analyzed ${total} frames.`, { duration: 2500 });
    } catch (e) {
      const msg = e.message || String(e);
      setLiveError(msg.includes("503") || msg.includes("not found") ? "models" : "network");
      toast.error(msg, { duration: 6000 });
    } finally {
      if (sid) await deleteLiveSession(sid).catch(() => {});
      setUploadAnalyzing(false);
      setUploadProgress(null);
    }
  }, [uploadFile, uploadFps, processFrameBlob]);

  useEffect(() => {
    if (!cameraOn) return undefined;
    analyzeTimerRef.current = setInterval(async () => {
      const blob = await captureBlob();
      const sid = sessionIdRef.current;
      if (!sid) return;
      await processFrameBlob(blob, { sessionId: sid });
    }, 450);
    return () => {
      if (analyzeTimerRef.current) {
        clearInterval(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    };
  }, [cameraOn, captureBlob, processFrameBlob]);

  /** CV-style HUD: skeleton + box + labels — live camera and uploaded video share the same pipeline. */
  useEffect(() => {
    const live = tab === "live";
    const shell = live ? shellRef.current : uploadShellRef.current;
    const video = live ? videoRef.current : uploadVideoRef.current;
    const canvas = live ? overlayRef.current : uploadOverlayRef.current;
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

      const show =
        live && cameraOn && video.videoWidth
          ? true
          : !live && uploadFile?.type?.startsWith("video/") && uploadVideoReady && video.videoWidth;

      if (!show) {
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
      else if (riskSnap?.risk === "High" || riskSnap?.risk === "Medium") stateLine = "State: Elevated risk";
      else if (act !== "Unknown") stateLine = live ? "State: Tracking" : "State: Normal";
      else if (!live && srvVis >= 6) stateLine = "State: Normal";
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
        targetLabel: live ? "Target ID 1" : "Target ID 0",
        insideBoxText: live ? "Memory Aid · live pose feed" : "Memory Aid · video upload",
      });
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(shell);
    const onVid = () => paint();
    video.addEventListener("loadedmetadata", onVid);
    video.addEventListener("playing", onVid);
    video.addEventListener("seeked", onVid);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", onVid);
      video.removeEventListener("playing", onVid);
      video.removeEventListener("seeked", onVid);
    };
  }, [lastFrame, cameraOn, liveError, riskSnap, tab, uploadFile, uploadVideoReady]);

  useEffect(() => {
    const el = uploadLogPreRef.current;
    if (!el || tab !== "upload" || uploadDetectionLogs.length === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [uploadDetectionLogs, tab]);

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

  const toggleAlerts = async (on) => {
    setAlertsEnabled(on);
    localStorage.setItem(LS_ALERTS, on ? "1" : "0");
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    if (!on) {
      lastBrowserAlertIdRef.current = null;
    }
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
            : riskSnap?.risk === "High" || riskSnap?.risk === "Medium"
              ? `State: ${riskSnap.risk} — ${riskSnap.behavior_type || ""}`
              : `State: ${action}`;

  const behaviorLine =
    riskSnap?.behavior_type && riskSnap?.risk !== "Normal"
      ? `${riskSnap.risk} · ${riskSnap.behavior_type}`
      : posture === "Uncertain posture"
        ? "No reliable f…"
        : riskSnap?.behavior_type || "Observation";

  const logLine = buildTechnicalLogLine({
    tab,
    cameraOn,
    liveError,
    lastFrame,
    riskSnap,
  });

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
            Upload a short video to review the human-activity timeline with the same YOLOv8-pose + LSTM
            pipeline as live camera. Frames are sampled in the browser (cap 1500 frames); use modest
            clips to avoid overload. MP4, MOV, AVI, WebM up to 200&nbsp;MB.
          </p>

          <div
            role="button"
            tabIndex={0}
            className={`dc-upload-dropzone ${uploadDropActive ? "dc-upload-dropzone--active" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setUploadDropActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setUploadDropActive(true);
            }}
            onDragLeave={() => setUploadDropActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setUploadDropActive(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) assignUploadFile(f);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openUploadPicker();
              }
            }}
          >
            <div className="dc-upload-dropzone-icon" aria-hidden>
              ☁️
            </div>
            <p>Drag and drop a file here, or browse.</p>
            <div className="dc-upload-dropzone-actions">
              <button type="button" className="btn-secondary" onClick={openUploadPicker}>
                Browse files
              </button>
            </div>
          </div>

          {uploadFile && (
            <div className="dc-upload-file-row">
              <span className="dc-upload-file-row-icon" aria-hidden>
                {uploadFile.type.startsWith("video/") ? "🎬" : "🖼️"}
              </span>
              <div className="dc-upload-file-meta">
                <div className="dc-upload-file-name">{uploadFile.name}</div>
                <div className="dc-upload-file-size">{formatBytes(uploadFile.size)}</div>
              </div>
              <button
                type="button"
                className="dc-upload-remove"
                title="Remove file"
                onClick={clearUploadSelection}
                disabled={uploadAnalyzing}
              >
                🗑️
              </button>
            </div>
          )}

          <div className="dc-upload-controls">
            {uploadFile?.type.startsWith("video/") && (
              <div className="dc-slider-row">
                <label htmlFor="dc-upload-fps">Sample rate (frames / sec)</label>
                <input
                  id="dc-upload-fps"
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={uploadFps}
                  onChange={(e) => setUploadFps(Number(e.target.value))}
                />
                <span className="dc-slider-val">{uploadFps}</span>
              </div>
            )}
            <div className="dc-slider-row">
              <label htmlFor="dc-upload-edge">Exit-zone edge threshold</label>
              <input
                id="dc-upload-edge"
                type="range"
                min="0.05"
                max="0.35"
                step="0.01"
                value={edgeThreshold}
                onChange={(e) => setEdgeThreshold(Number(e.target.value))}
              />
              <span className="dc-slider-val">{edgeThreshold.toFixed(2)}</span>
            </div>
            <label className="dc-check">
              <input
                type="checkbox"
                checked={monitorExitZone}
                onChange={(e) => setMonitorExitZone(e.target.checked)}
                disabled={uploadAnalyzing}
              />
              Monitor exit-zone for uploaded video
            </label>
          </div>

          {uploadAnalyzing && uploadProgress && (
            <div className="dc-upload-progress">
              <div className="dc-upload-progress-label">
                Analyzing frame {uploadProgress.current}/{uploadProgress.total}…
              </div>
              <div className="dc-upload-progress-track">
                <div
                  className="dc-upload-progress-fill"
                  style={{
                    width: `${Math.min(100, (100 * uploadProgress.current) / Math.max(uploadProgress.total, 1))}%`,
                  }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            className="dc-btn-analyze"
            disabled={
              uploadAnalyzing ||
              !uploadFile ||
              (uploadFile.type.startsWith("video/") && !uploadVideoReady)
            }
            onClick={() => {
              if (uploadFile?.type.startsWith("image/")) void analyzeUploadedImage();
              else void analyzeUploadedVideo();
            }}
          >
            {uploadFile?.type.startsWith("image/") ? "Analyze image" : "Analyze uploaded video"}
          </button>

          {uploadFile?.type.startsWith("image/") && uploadObjectUrl && (
            <img
              ref={uploadImgRef}
              src={uploadObjectUrl}
              alt="Upload preview"
              className="dc-upload-preview-img"
            />
          )}

          {uploadFile?.type.startsWith("video/") && uploadObjectUrl && (
            <div className="dc-video-shell" ref={uploadShellRef}>
              <video
                key={uploadObjectUrl}
                ref={uploadVideoRef}
                className="dc-upload-video"
                src={uploadObjectUrl}
                playsInline
                muted
                preload="auto"
                onLoadedMetadata={(e) => {
                  if (e.currentTarget.videoWidth) setUploadVideoReady(true);
                }}
                onError={() => {
                  setUploadVideoReady(false);
                  toast.error(
                    "This video failed to load in the browser. Try MP4 with H.264/AAC.",
                    { duration: 6000 }
                  );
                }}
              />
              <canvas
                ref={uploadOverlayRef}
                className={`dc-pose-overlay ${
                  uploadVideoReady ? "dc-pose-overlay--on" : "dc-pose-overlay--off"
                }`}
                aria-hidden
              />
              {!uploadVideoReady && (
                <div className="dc-video-placeholder">Load a video to preview</div>
              )}
              {uploadVideoReady && (
                <div className="dc-upload-frame-footer">
                  {uploadAnalyzing && uploadProgress ? (
                    <>
                      Analyzing frame {uploadProgress.current}/{uploadProgress.total}… |{" "}
                    </>
                  ) : (
                    <>Preview (seek while analyzing) | </>
                  )}
                  {liveError === "models"
                    ? "Models missing"
                    : liveError === "network"
                      ? "API error"
                      : riskSnap?.risk === "High" || riskSnap?.risk === "Medium"
                        ? riskSnap.risk
                        : "Normal"}{" "}
                  |{" "}
                  {lastFrame?.incident_saved
                    ? "Incident saved — see Captures tab"
                    : riskSnap?.risk === "High" || riskSnap?.risk === "Medium"
                      ? riskSnap.reason || riskSnap.behavior_type || "Review signals"
                      : "No abnormal behavior candidate."}
                </div>
              )}
            </div>
          )}
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
                <li
                  key={row.Id}
                  className="dc-capture-card dc-capture-card--click"
                  onClick={() => setSelectedIncident(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedIncident(row);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="dc-capture-title">
                    {row.BehaviorType}{" "}
                    <span className="dc-badge">{row.Severity}</span>
                  </div>
                  <div className="dc-capture-meta">
                    {row.Time} — {row.Reason}
                    <span className="dc-capture-hint"> · Open detail</span>
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
                : lastFrame?.incident_pending_until
                  ? "Post-capture buffering (≈2s) after confirmed risk"
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
            : riskSnap?.risk === "Medium"
              ? `Watch closely (${riskSnap.risk}): ${riskSnap.behavior_type} — ${riskSnap.reason}`
              : "Pose OK — monitoring continues. Normal activity is not logged as an abnormal capture."}
      </div>

      {tab === "upload" && uploadDetectionLogs.length > 0 && (
        <p className="dc-upload-log-hint dc-muted">
          Video upload: per-frame detection log (same pipe-separated fields as live camera). Latest at bottom.
        </p>
      )}
      <pre
        ref={uploadLogPreRef}
        className={`dc-log${tab === "upload" && uploadDetectionLogs.length ? " dc-log--upload-scroll" : ""}`}
        aria-label="Technical log"
      >
        {tab === "upload" && uploadDetectionLogs.length > 0 ? uploadDetectionLogs.join("\n") : logLine}
      </pre>

      <section className="dc-dash-tables" aria-label="Live behaviour and alert history">
        <div className="dc-dash-col">
          <h3 className="dc-subheading">Recent behaviour events</h3>
          <p className="dc-muted dc-small-margin">
            Medium / High risk only (server, deduped ≈10s). Latest 10.
          </p>
          <div className="dc-table-wrap">
            <table className="dc-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Risk</th>
                  <th>Action</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {riskEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dc-table-empty">
                      No medium/high events yet this session.
                    </td>
                  </tr>
                ) : (
                  riskEvents.map((ev, idx) => (
                    <tr key={`${ev.timestamp}-${idx}`}>
                      <td>{ev.time}</td>
                      <td>{ev.risk}</td>
                      <td>{ev.action}</td>
                      <td className="dc-table-clamp">{ev.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="dc-dash-col">
          <h3 className="dc-subheading">Caregiver alert history</h3>
          <p className="dc-muted dc-small-margin">Latest 8 dispatch rows (email + browser ack).</p>
          <div className="dc-table-wrap">
            <table className="dc-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Behaviour</th>
                  <th>Severity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {alertLog.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dc-table-empty">
                      No alerts logged yet.
                    </td>
                  </tr>
                ) : (
                  alertLog.map((a, idx) => (
                    <tr key={`${a.timestamp}-${idx}`}>
                      <td>{a.time}</td>
                      <td>{a.behavior}</td>
                      <td>{a.severity}</td>
                      <td className="dc-table-clamp">{a.status_message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

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
          {soundManual && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const ok = playAlertBeep();
                if (ok) setSoundManual(false);
              }}
            >
              Play alert sound
            </button>
          )}
          <span className="dc-muted inline-hint">
            Uses browser notifications when allowed. Server email: set{" "}
            <code className="inline-code">DEMENTIA_CAREGIVER_EMAIL</code> (or{" "}
            <code className="inline-code">CAREGIVER_ALERT_EMAIL</code>) and{" "}
            <code className="inline-code">SMTP_*</code> — sent automatically when an incident is saved; pose
            lines are included in the message body.
          </span>
        </div>
      </section>

      {selectedIncident && (
        <div
          className="dc-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dc-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedIncident(null);
          }}
        >
          <div className="dc-modal">
            <div className="dc-modal-head">
              <h3 id="dc-modal-title">{selectedIncident.BehaviorType || "Incident"}</h3>
              <button type="button" className="btn-secondary" onClick={() => setSelectedIncident(null)}>
                Close
              </button>
            </div>
            <div className="dc-modal-body">
              {selectedIncident.SnapshotUrl || selectedIncident.Id ? (
                <img
                  src={`${ASSET_BASE}${selectedIncident.SnapshotUrl || `/api/dementia-action/incident-asset/${selectedIncident.Id}/snapshot`}`}
                  alt="Incident snapshot"
                  className="dc-modal-img"
                />
              ) : null}
              {selectedIncident.ClipUrl || selectedIncident.Id ? (
                <video
                  src={`${ASSET_BASE}${selectedIncident.ClipUrl || `/api/dementia-action/incident-asset/${selectedIncident.Id}/clip`}`}
                  controls
                  className="dc-modal-video"
                >
                  <track kind="captions" />
                </video>
              ) : null}
              <dl className="dc-modal-dl">
                <div>
                  <dt>Time</dt>
                  <dd>{selectedIncident.Time}</dd>
                </div>
                <div>
                  <dt>Detected action</dt>
                  <dd>{selectedIncident.Action}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{selectedIncident.Confidence}</dd>
                </div>
                <div>
                  <dt>Severity</dt>
                  <dd>{selectedIncident.Severity}</dd>
                </div>
                <div className="dc-modal-dl-full">
                  <dt>Reason</dt>
                  <dd>{selectedIncident.Reason}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
