// src/App.js
import React, { useState, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Outlet,
  useLocation,
  Navigate,
} from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { subscribeToReminders } from "./firebase/reminders";
import { useReminderChecker } from "./hooks/useReminderChecker";
import { useOutdoorAckSync } from "./hooks/useOutdoorAckSync";
import Reminders from "./pages/Reminders";
import Analytics from "./pages/Analytics";
import MemoryAid from "./pages/MemoryAid";
import DementiaAction from "./pages/DementiaAction";
import CognitiveScreeningShell from "./cognitive-screening/CognitiveScreeningShell";
import CognitiveScreeningHome from "./cognitive-screening/CognitiveScreeningHome";
import ScreeningPatientInfo from "./cognitive-screening/pages/PatientInfo";
import ScreeningMmseTest from "./cognitive-screening/pages/MmseTest";
import ScreeningAdvancedTest from "./cognitive-screening/pages/AdvancedTest";
import ScreeningDashboard from "./cognitive-screening/pages/Dashboard";
import { getMode, setMode } from "./services/modeApi";
import GuardianWebApp from "./guardian/GuardianWebApp";
import { GuardianRootGate, GuardianDemoLayout } from "./guardian/App.tsx";
import { LoginPage } from "./guardian/pages/LoginPage.tsx";
import { RegisterPage } from "./guardian/pages/RegisterPage.tsx";
import { PairingPage } from "./guardian/pages/PairingPage.tsx";
import { AlertsPage } from "./guardian/pages/guardian/AlertsPage.tsx";
import { ChatPage } from "./guardian/pages/guardian/ChatPage.tsx";
import { ClinicalFormPage } from "./guardian/pages/guardian/ClinicalFormPage.tsx";
import { DashboardPage } from "./guardian/pages/guardian/DashboardPage.tsx";
import { MriUploadPage } from "./guardian/pages/guardian/MriUploadPage.tsx";
import { ReportsPage } from "./guardian/pages/guardian/ReportsPage.tsx";
import { SettingsPage } from "./guardian/pages/guardian/SettingsPage.tsx";
import { PatientHomePage } from "./guardian/pages/patient/PatientHomePage.tsx";
import { GuardianShell } from "./guardian/layouts/GuardianShell.tsx";
import { PatientShell } from "./guardian/layouts/PatientShell.tsx";
import { RequireAuth } from "./guardian/routes/RequireAuth.tsx";
import "./App.css";
import "./cognitive-screening/styles.css";

function Layout({
  reminders,
  mode,
  dispatchStatus,
  onDispatchStatus,
}) {
  const location = useLocation();
  const guardianActive = location.pathname.startsWith("/dg");
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
          <NavLink to="/screening" className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <span>🧪</span> Cognitive screening
          </NavLink>
          <NavLink to="/dementia-action" className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`}>
            <span>🛡️</span> Dementia action
          </NavLink>
          <NavLink
            to="/dg"
            className={({ isActive }) =>
              `nav-link ${isActive || guardianActive ? "active" : ""}`
            }
          >
            <span>👪</span> Dementia guardian
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

      <main
        className={
          guardianActive
            ? "main-content main-content--guardian-host"
            : "main-content"
        }
      >
        <Outlet />
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
    <BrowserRouter
      future={{
        v7_relativeSplatPath: true,
      }}
    >
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
      <Routes>
        <Route
          element={
            <Layout
              reminders={reminders}
              mode={mode}
              dispatchStatus={dispatchStatus}
              onDispatchStatus={setDispatchStatus}
            />
          }
        >
          <Route
            index
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
          <Route path="analytics" element={<Analytics reminders={reminders} />} />
          <Route path="memory" element={<MemoryAid />} />
          <Route path="dementia-action" element={<DementiaAction />} />
          <Route path="screening" element={<CognitiveScreeningShell />}>
            <Route index element={<CognitiveScreeningHome />} />
            <Route path="patient" element={<ScreeningPatientInfo />} />
            <Route path="test" element={<ScreeningMmseTest />} />
            <Route path="test-advanced" element={<ScreeningAdvancedTest />} />
            <Route path="results" element={<ScreeningDashboard />} />
          </Route>
          <Route path="dg" element={<GuardianWebApp />}>
            <Route element={<GuardianDemoLayout />}>
              <Route index element={<GuardianRootGate />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="register" element={<RegisterPage />} />
              <Route element={<RequireAuth role="guardian" />}>
                <Route path="guardian" element={<GuardianShell />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="alerts" element={<AlertsPage />} />
                  <Route path="chat" element={<ChatPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="pairing" element={<PairingPage />} />
                  <Route path="clinical" element={<ClinicalFormPage />} />
                  <Route path="mri" element={<MriUploadPage />} />
                </Route>
              </Route>
              <Route element={<RequireAuth role="patient" />}>
                <Route path="patient" element={<PatientShell />}>
                  <Route index element={<PatientHomePage />} />
                  <Route path="pairing" element={<PairingPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/dg" replace />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
