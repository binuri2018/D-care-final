import React, { useState } from "react";
import toast from "react-hot-toast";
import { TARGET_BEACON_NAME } from "../ble/beaconConstants";

export default function ModeToggle({
  mode,
  source,
  autoModeSetting,
  lastRssi,
  onApplyMode,
}) {
  const [pending, setPending] = useState(false);
  const bleAuto =
    (autoModeSetting || "").trim().toLowerCase() === "bluetooth_auto";
  const srcLabel =
    source === "bluetooth_auto"
      ? "Mobile BLE (RSSI-driven)"
      : source === "manual"
        ? "Manual (web)"
        : source || "unknown";

  const run = async (fn) => {
    if (!onApplyMode) return;
    setPending(true);
    try {
      await fn();
    } catch {
      toast.error("Could not update mode. Is the backend running?");
    } finally {
      setPending(false);
    }
  };

  const chooseFollowPhone = () =>
    run(() =>
      onApplyMode({
        mode,
        source: "bluetooth_auto",
        autoModeSetting: "bluetooth_auto",
        reason: "web: follow phone BLE",
      }),
    );

  const chooseManual = () =>
    run(() =>
      onApplyMode({
        mode,
        source: "manual",
        autoModeSetting: "manual",
        reason: "web: manual control lock",
      }),
    );

  const setManualMode = (nextMode) =>
    run(() =>
      onApplyMode({
        mode: nextMode,
        source: "manual",
        autoModeSetting: "manual",
        reason: "web: set mode",
      }),
    );

  return (
    <div className="mode-toggle-card">
      <div className="mode-toggle-header">
        <h3>Indoor / Outdoor</h3>
        <span className={`mode-badge ${mode}`}>Current: {mode}</span>
      </div>
      <p className="mode-ble-explainer">
        Choose whether this dashboard follows your <strong>mobile app</strong>{" "}
        (beacon <strong>{TARGET_BEACON_NAME}</strong>) or you set indoor/outdoor{" "}
        <strong>manually here</strong>. The web does not scan Bluetooth; in
        follow-phone mode the backend updates from the phone every few seconds.
      </p>

      <div className="mode-control-segment" role="group" aria-label="Mode control">
        <button
          type="button"
          className={`mode-seg-btn ${bleAuto ? "active" : ""}`}
          disabled={pending}
          onClick={chooseFollowPhone}
        >
          Follow phone (BLE)
        </button>
        <button
          type="button"
          className={`mode-seg-btn ${!bleAuto ? "active" : ""}`}
          disabled={pending}
          onClick={chooseManual}
        >
          Manual
        </button>
      </div>

      {!bleAuto && (
        <div className="mode-toggle-actions mode-manual-actions">
          <button
            type="button"
            className={`mode-badge indoor ${mode === "indoor" ? "active-mode" : ""}`}
            disabled={pending}
            onClick={() => setManualMode("indoor")}
          >
            Indoor
          </button>
          <button
            type="button"
            className={`mode-badge outdoor ${mode === "outdoor" ? "active-mode" : ""}`}
            disabled={pending}
            onClick={() => setManualMode("outdoor")}
          >
            Outdoor
          </button>
        </div>
      )}

      <div className="mode-meta-row">
        <span>Backend source: {srcLabel}</span>
        <span>Auto: {bleAuto ? "Mobile beacon RSSI" : "Manual on web"}</span>
        <span>
          Last RSSI (from phone→server):{" "}
          {typeof lastRssi === "number" ? `${lastRssi} dBm` : "N/A"}
        </span>
      </div>
    </div>
  );
}
