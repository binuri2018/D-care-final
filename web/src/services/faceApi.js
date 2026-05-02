const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";

export async function faceGetConstants() {
  const res = await fetch(`${BACKEND_URL}/api/face/constants`);
  if (!res.ok) throw new Error("Failed to load face subsystem constants");
  return res.json();
}

export async function faceIdentify(file, { inputBgr = false } = {}) {
  const fd = new FormData();
  fd.append("image", file);
  const q = inputBgr ? "?input_bgr=true" : "";
  const res = await fetch(`${BACKEND_URL}/api/face/identify${q}`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Face identify failed");
  }
  return res.json();
}

export async function faceRegisterBatch(name, files) {
  const fd = new FormData();
  fd.append("name", name);
  files.forEach((f) => fd.append("images", f));
  const res = await fetch(`${BACKEND_URL}/api/face/register/batch`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Batch register failed");
  }
  return res.json();
}

export async function faceRegisterSessionStart(name = "") {
  const fd = new FormData();
  fd.append("name", name);
  const res = await fetch(`${BACKEND_URL}/api/face/register/session`, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Could not start session");
  return res.json();
}

export async function faceRegisterSessionRename(sessionId, name) {
  const fd = new FormData();
  fd.append("name", name);
  const res = await fetch(`${BACKEND_URL}/api/face/register/session/${sessionId}/name`, {
    method: "PATCH",
    body: fd,
  });
  if (!res.ok) throw new Error("Could not set session name");
  return res.json();
}

export async function faceRegisterSessionFrame(sessionId, file, { inputBgr = false } = {}) {
  const fd = new FormData();
  fd.append("image", file);
  const q = inputBgr ? "?input_bgr=true" : "";
  const res = await fetch(`${BACKEND_URL}/api/face/register/session/${sessionId}/frame${q}`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Frame rejected");
  }
  return res.json();
}

export async function faceRegisterSessionFinalize(sessionId) {
  const res = await fetch(`${BACKEND_URL}/api/face/register/session/${sessionId}/finalize`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Finalize failed");
  }
  return res.json();
}

export async function faceRegisterSessionAbort(sessionId) {
  await fetch(`${BACKEND_URL}/api/face/register/session/${sessionId}`, { method: "DELETE" });
}

export async function faceListEnrolled() {
  const res = await fetch(`${BACKEND_URL}/api/face/database/people`);
  if (!res.ok) throw new Error("Failed to list enrolled");
  return res.json();
}
