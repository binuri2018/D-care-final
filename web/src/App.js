// src/App.js
import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { subscribeToReminders } from "./firebase/reminders";
import { useReminderChecker } from "./hooks/useReminderChecker";
import { useOutdoorAckSync } from "./hooks/useOutdoorAckSync";
import Reminders from "./pages/Reminders";
import Analytics from "./pages/Analytics";
import MemoryAid from "./pages/MemoryAid";
import { getMode, setMode } from "./services/modeApi";
import "./App.css";

function Layout({
  reminders,
  mode,
  dispatchStatus,
  onDispatchStatus,
}) {
  useReminderChecker(reminders, mode, onDispatchStatus);
  useOutdoorAckSync(reminders, onDispatchStatus);
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand brand-memory-aid">
          <div className="brand-icon" aria-hidden>🧠</div>
          <div className="brand-name">Memory Aid</div>
        </div>

        <div className="nav-links">
          <NavLink to="/" className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`} end>
            <span>🔔</span> Reminders
          </NavLink>
          <NavLink to="/analytics" className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <span>📊</span> Analytics
          </NavLink>
          <NavLink to="/memory" className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <span>🧠</span> Memory
          </NavLink>
        </div>

        <div className="sidebar-footer">
          <div className="voice-info">
            <span>🎤</span>
            <span>Voice input supported</span>
          </div>
          <div className="voice-info">
            <span>🔊</span>
            <span>Speaker alerts active</span>
          </div>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              <Reminders
                reminders={reminders}
                mode={mode}
                modeSource={dispatchStatus.source}
                autoModeSetting={dispatchStatus.autoModeSetting}
                lastRssi={dispatchStatus.lastRssi}
                dispatchStatus={dispatchStatus}
              />
            }
          />
          <Route path="/analytics" element={<Analytics reminders={reminders} />} />
          <Route path="/memory" element={<MemoryAid />} />
        </Routes>
      </main>
    </div>
  );
}

/** Poll `/api/mode` this often so indoor/outdoor (driven only by mobile BLE) mirrors quickly on web */
const MODE_POLL_MS = 5000;

export default function App() {
  const [reminders, setReminders] = useState([]);
  const [mode, setModeState] = useState("indoor");
  const migratedAutoRef = useRef(false);

  const [dispatchStatus, setDispatchStatus] = useState({
    mode: "indoor",
    source: "bluetooth_auto",
    autoModeSetting: "bluetooth_auto",
    lastRssi: null,
    lastEvent: "",
    lastReminderTitle: "",
    state: "idle",
  });

  useEffect(() => {
    const unsub = subscribeToReminders(setReminders);
    return () => unsub();
  }, []);

  useEffect(() => {
    const loadMode = async () => {
      try {
        let data = await getMode();

        if (!migratedAutoRef.current) {
          if (
            (data.autoModeSetting || "").toLowerCase() !== "bluetooth_auto"
          ) {
            try {
              data = await setMode({
                mode: data.mode || "indoor",
                source: "bluetooth_auto",
                autoModeSetting: "bluetooth_auto",
                reason: "BLE beacon mode is mobile-led; unify auto setting",
              });
            } catch (_) {}
          }
          migratedAutoRef.current = true;
        }

        setModeState(data.mode);
        setDispatchStatus((prev) => ({
          ...prev,
          mode: data.mode,
          source: data.source || "bluetooth_auto",
          autoModeSetting: data.autoModeSetting || "bluetooth_auto",
          lastRssi: typeof data.lastRssi === "number" ? data.lastRssi : null,
        }));
      } catch {
        // indoor fallback mode if offline
      }
    };
    loadMode();
    const poll = setInterval(loadMode, MODE_POLL_MS);
    return () => clearInterval(poll);
  }, []);

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#ffffff",
            color: "#1a3348",
            border: "1px solid rgba(26, 58, 95, 0.12)",
            boxShadow: "0 8px 24px rgba(26, 43, 66, 0.08)",
          },
        }}
      />
      <Layout
        reminders={reminders}
        mode={mode}
        dispatchStatus={dispatchStatus}
        onDispatchStatus={setDispatchStatus}
      />
    </BrowserRouter>
  );
}
