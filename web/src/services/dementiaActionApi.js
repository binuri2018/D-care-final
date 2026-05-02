const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";

export async function fetchDementiaActionHealth() {
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function fetchDementiaIncidents(limit = 50) {
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/incidents?limit=${limit}`);
  if (!r.ok) throw new Error(`incidents ${r.status}`);
  return r.json();
}

export async function fetchAlertPreview(incidentId = null) {
  const q = incidentId ? `?incident_id=${encodeURIComponent(incidentId)}` : "";
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/alert-preview${q}`);
  if (!r.ok) throw new Error(`alert-preview ${r.status}`);
  return r.json();
}

export async function analyzeFrame(blob) {
  const fd = new FormData();
  fd.append("file", blob, "frame.jpg");
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/analyze-frame`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `analyze ${r.status}`);
  }
  return r.json();
}

export async function createLiveSession() {
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/live/session`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(`live session ${r.status}`);
  return r.json();
}

export async function deleteLiveSession(sessionId) {
  if (!sessionId) return { ok: true, deleted: false };
  const r = await fetch(
    `${BACKEND_URL}/api/dementia-action/live/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
  if (!r.ok) throw new Error(`live session delete ${r.status}`);
  return r.json();
}

export async function postLiveFrame(blob, { sessionId, useExitZone = true, edge = 0.15 } = {}) {
  const fd = new FormData();
  fd.append("session_id", sessionId);
  fd.append("use_exit_zone", useExitZone ? "true" : "false");
  fd.append("edge", String(edge));
  fd.append("file", blob, "frame.jpg");
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/live/frame`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const t = await r.text();
    const err = new Error(t || `live frame ${r.status}`);
    err.statusCode = r.status;
    throw err;
  }
  return r.json();
}

export async function simulateRisk(payload) {
  const r = await fetch(`${BACKEND_URL}/api/dementia-action/risk/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`risk simulate ${r.status}`);
  return r.json();
}
