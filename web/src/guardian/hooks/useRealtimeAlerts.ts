import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';

/** Subscribes to `alert:new` on the shared auth Socket.IO client (one connection per session). */
export function useRealtimeAlerts(onAlert: () => void) {
  const { token, user, guardianSocket } = useAuth();

  useEffect(() => {
    if (!token || !user || !guardianSocket) return undefined;
    guardianSocket.on('alert:new', onAlert);
    return () => {
      guardianSocket.off('alert:new', onAlert);
    };
  }, [token, user, guardianSocket, onAlert]);
}
