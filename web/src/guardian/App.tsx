import { Box } from '@mui/material';
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { DemoPhoneFrame } from './components/DemoPhoneFrame.tsx';
import { DemoLayoutProvider } from './context/DemoLayoutContext.tsx';
import { useAuth } from './context/AuthContext.tsx';

/** `/dg` index: send to login or role home (paths relative to `/dg`). */
export function GuardianRootGate() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated || !user) {
    return <Navigate to="login" replace />;
  }
  return <Navigate to={user.role === 'guardian' ? 'guardian' : 'patient'} replace />;
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

/** Optional phone-frame layout around all `/dg/*` child routes. */
export function GuardianDemoLayout() {
  const [params] = useSearchParams();
  const usePhoneFrame = readDemoPhoneFrame(params);

  return (
    <DemoLayoutProvider value={usePhoneFrame}>
      {usePhoneFrame ? (
        <DemoPhoneFrame>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Outlet />
          </Box>
        </DemoPhoneFrame>
      ) : (
        <Outlet />
      )}
    </DemoLayoutProvider>
  );
}
