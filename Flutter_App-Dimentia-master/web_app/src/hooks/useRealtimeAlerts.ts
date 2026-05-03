import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { defaultApiBase, socketOriginFromApiBase } from '../api/session';
import { useAuth } from '../context/AuthContext';

/** Second Socket.IO connection for pages that should react to server pushes without coupling to core auth socket lifecycle. */
export function useRealtimeAlerts(onAlert: () => void) {
  const { token, user, apiBaseUrl } = useAuth();

  useEffect(() => {
    if (!token || !user) return;
    const base = apiBaseUrl?.trim() || defaultApiBase();
    const sock = io(socketOriginFromApiBase(base), {
      transports: ['websocket'],
      query: { userId: user.id, role: user.role },
    });
    sock.on('alert:new', onAlert);
    return () => {
      sock.disconnect();
    };
  }, [token, user, apiBaseUrl, onAlert]);
}
