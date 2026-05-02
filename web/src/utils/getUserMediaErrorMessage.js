/**
 * Maps DOMException from getUserMedia to actionable text.
 * "NotAllowedError" / "Permission denied by system" = browser or OS denied access.
 */
export function getUserMediaErrorMessage(err, device) {
  const kind = device === "mic" ? "Microphone" : "Camera";
  const name = err?.name || "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return `${kind} blocked. Allow access for this site (address-bar lock icon → Permissions). If it still fails, open Windows Settings → Privacy & security → ${kind === "Camera" ? "Camera" : "Microphone"} → turn on access for the browser and desktop apps.`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return `No ${kind.toLowerCase()} was found. Plug one in or enable it in Device Manager.`;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return `${kind} is in use by another app, or the driver failed. Close other apps using it and try again.`;
  }
  if (name === "OverconstrainedError") {
    return `${kind} does not support the requested settings. Try another browser or device.`;
  }
  if (name === "SecurityError") {
    return `${kind} requires a secure context. Use http://localhost:3000 (or HTTPS), not a raw file URL or blocked origin.`;
  }
  const msg = typeof err?.message === "string" ? err.message : "";
  if (/denied by system/i.test(msg)) {
    return `${kind} blocked by the system. Check Windows Privacy settings for ${kind.toLowerCase()} and ensure your browser is allowed.`;
  }
  return msg || `Could not open ${kind.toLowerCase()}.`;
}
