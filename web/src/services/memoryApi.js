const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";

function apiErrorDetail(payload) {
  const d = payload?.detail;
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

export async function memoryListPeople() {
  const res = await fetch(`${BACKEND_URL}/api/memory/people`);
  if (!res.ok) throw new Error("Failed to list people");
  return res.json();
}

export async function memoryGetPerson(name) {
  const res = await fetch(`${BACKEND_URL}/api/memory/people/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Failed to load person");
  return res.json();
}

export async function memoryIdentifyFace(file) {
  const fd = new FormData();
  fd.append("image", file);
  const res = await fetch(`${BACKEND_URL}/api/memory/face/identify`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Face identify failed");
  }
  return res.json();
}

export async function memoryRegisterFace(name, files) {
  const fd = new FormData();
  fd.append("name", name);
  files.forEach((f) => fd.append("images", f));
  const res = await fetch(`${BACKEND_URL}/api/memory/face/register`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Face registration failed");
  }
  return res.json();
}

export async function memorySaveMemories(name, description, photoFiles) {
  const fd = new FormData();
  fd.append("description", description || "");
  (photoFiles || []).forEach((f) => fd.append("photos", f));
  const res = await fetch(`${BACKEND_URL}/api/memory/people/${encodeURIComponent(name)}/memories`, {
    method: "PUT",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Save failed");
  }
  return res.json();
}

export async function memoryRegisterVoice(name, audioBlob) {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("audio", audioBlob, "voice.wav");
  const res = await fetch(`${BACKEND_URL}/api/memory/voice/register`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorDetail(err) || "Voice registration failed");
  }
  return res.json();
}

export async function memoryIdentifyVoice(audioBlob) {
  const fd = new FormData();
  fd.append("audio", audioBlob, "voice.wav");
  const res = await fetch(`${BACKEND_URL}/api/memory/voice/identify`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(apiErrorDetail(err) || "Voice identify failed");
  }
  return res.json();
}

export function memoryPhotoSrc(urlPath) {
  if (!urlPath) return "";
  if (urlPath.startsWith("http")) return urlPath;
  return `${BACKEND_URL}${urlPath}`;
}
