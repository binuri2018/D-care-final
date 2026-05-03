import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { GUARDIAN_BASE } from '../paths.ts';

export function RequireAuth({ role }: { role?: 'patient' | 'guardian' }) {
  const { isAuthenticated, user } = useAuth();
  const loc = useLocation();

  if (!isAuthenticated || !user) {
    return <Navigate to={`${GUARDIAN_BASE}/login`} replace state={{ from: loc.pathname }} />;
  }

  const actual = (user.role ?? '').toLowerCase() as 'patient' | 'guardian';
  if (role && actual !== role) {
    return (
      <Navigate to={actual === 'guardian' ? `${GUARDIAN_BASE}/guardian` : `${GUARDIAN_BASE}/patient`} replace />
    );
  }

  return <Outlet />;
}
