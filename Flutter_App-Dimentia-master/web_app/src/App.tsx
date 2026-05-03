import { Box } from '@mui/material';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { DemoPhoneFrame } from './components/DemoPhoneFrame';
import { DemoLayoutProvider } from './context/DemoLayoutContext';
import { useAuth } from './context/AuthContext';
import { GuardianShell } from './layouts/GuardianShell';
import { PatientShell } from './layouts/PatientShell';
import { LoginPage } from './pages/LoginPage';
import { PairingPage } from './pages/PairingPage';
import { RegisterPage } from './pages/RegisterPage';
import { AlertsPage } from './pages/guardian/AlertsPage';
import { ChatPage } from './pages/guardian/ChatPage';
import { ClinicalFormPage } from './pages/guardian/ClinicalFormPage';
import { DashboardPage } from './pages/guardian/DashboardPage';
import { MriUploadPage } from './pages/guardian/MriUploadPage';
import { ReportsPage } from './pages/guardian/ReportsPage';
import { SettingsPage } from './pages/guardian/SettingsPage';
import { PatientHomePage } from './pages/patient/PatientHomePage';
import { RequireAuth } from './routes/RequireAuth';

function RootGate() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'guardian' ? '/guardian' : '/patient'} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootGate />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth role="guardian" />}>
        <Route path="/guardian" element={<GuardianShell />}>
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
        <Route path="/patient" element={<PatientShell />}>
          <Route index element={<PatientHomePage />} />
          <Route path="pairing" element={<PairingPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function readDemoPhoneFrame(searchParams: URLSearchParams): boolean {
  const d = searchParams.get('demo');
  if (d === '0' || d === 'false' || d === 'no') {
    sessionStorage.removeItem('demoPhoneFrame');
    return false;
  }
  if (d === '1' || d === 'true' || d === 'yes') {
    sessionStorage.setItem('demoPhoneFrame', '1');
    return true;
  }
  return sessionStorage.getItem('demoPhoneFrame') === '1';
}

export function App() {
  const [params] = useSearchParams();
  const usePhoneFrame = readDemoPhoneFrame(params);

  return (
    <DemoLayoutProvider value={usePhoneFrame}>
      {usePhoneFrame ? (
        <DemoPhoneFrame>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <AppRoutes />
          </Box>
        </DemoPhoneFrame>
      ) : (
        <AppRoutes />
      )}
    </DemoLayoutProvider>
  );
}
