import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  clearSession,
  createHttp,
  defaultApiBase,
  loadStoredSession,
  parseUserRole,
  persistApiBase,
  persistSelectedPatient,
  persistSession,
  socketOriginFromApiBase,
  type AppUser,
} from '../api/session.ts';

type AuthContextValue = {
  loading: boolean;
  token: string | null;
  user: AppUser | null;
  apiBaseUrl: string;
  selectedPatientId: string | null;
  /** Shared Socket.IO client (null when logged out). Reused by alert hooks — do not disconnect from consumers. */
  guardianSocket: Socket | null;
  isAuthenticated: boolean;
  http: ReturnType<typeof createHttp>;
  setApiBaseUrl: (url: string) => void;
  setSelectedPatientId: (id: string | null) => void;
  login: (email: string, password: string) => Promise<AppUser>;
  register: (payload: {
    fullName: string;
    email: string;
    password: string;
    role: 'patient' | 'guardian';
  }) => Promise<AppUser>;
  logout: () => void;
  refreshPairingPatient: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = loadStoredSession();
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(initial.token);
  const [user, setUser] = useState<AppUser | null>(initial.user);
  const [apiBaseUrl, setApiBaseUrlState] = useState(initial.apiBaseUrl || defaultApiBase());
  const [selectedPatientId, setSelectedPatientIdState] = useState<string | null>(initial.selectedPatientId);
  const socketRef = useRef<Socket | null>(null);
  const [guardianSocket, setGuardianSocket] = useState<Socket | null>(null);

  const http = useMemo(() => createHttp(apiBaseUrl, token), [apiBaseUrl, token]);

  const connectSocket = useCallback((u: AppUser, base: string) => {
    socketRef.current?.disconnect();
    const origin = socketOriginFromApiBase(base);
    socketRef.current = io(origin, {
      transports: ['websocket'],
      query: { userId: u.id, role: u.role },
      autoConnect: true,
    });
  }, []);

  useEffect(() => {
    if (!token || !user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setGuardianSocket(null);
      return undefined;
    }
    connectSocket(user, apiBaseUrl);
    setGuardianSocket(socketRef.current);
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setGuardianSocket(null);
    };
  }, [token, user, apiBaseUrl, connectSocket]);

  const setApiBaseUrl = useCallback((url: string) => {
    const trimmed = url.trim() || defaultApiBase();
    persistApiBase(trimmed);
    setApiBaseUrlState(trimmed);
  }, []);

  const setSelectedPatientId = useCallback((id: string | null) => {
    persistSelectedPatient(id);
    setSelectedPatientIdState(id?.trim() || null);
    const sock = socketRef.current;
    const pid = id?.trim();
    if (sock?.connected && pid) {
      sock.emit('join-patient-room', pid);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const client = createHttp(apiBaseUrl, null);
        const { data } = await client.post<{ token: string; user: Record<string, unknown> }>('/auth/login', {
          email,
          password,
        });
        const nextUser: AppUser = {
          id: String(data.user?.id ?? ''),
          fullName: String(data.user?.fullName ?? ''),
          email: String(data.user?.email ?? ''),
          role: parseUserRole(data.user?.role),
        };
        setToken(data.token);
        setUser(nextUser);
        const sel = nextUser.role === 'patient' ? null : selectedPatientId;
        persistSession({
          token: data.token,
          user: nextUser,
          apiBaseUrl,
          selectedPatientId: sel,
        });
        if (nextUser.role === 'patient') setSelectedPatientIdState(null);
        return nextUser;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, selectedPatientId]
  );

  const register = useCallback(
    async (payload: { fullName: string; email: string; password: string; role: 'patient' | 'guardian' }) => {
      setLoading(true);
      try {
        const client = createHttp(apiBaseUrl, null);
        const { data } = await client.post<{ token: string; user: Record<string, unknown> }>('/auth/register', payload);
        const nextUser: AppUser = {
          id: String(data.user?.id ?? ''),
          fullName: String(data.user?.fullName ?? ''),
          email: String(data.user?.email ?? ''),
          role: parseUserRole(data.user?.role),
        };
        setToken(data.token);
        setUser(nextUser);
        const sel = nextUser.role === 'patient' ? null : selectedPatientId;
        persistSession({
          token: data.token,
          user: nextUser,
          apiBaseUrl,
          selectedPatientId: sel,
        });
        if (nextUser.role === 'patient') setSelectedPatientIdState(null);
        return nextUser;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, selectedPatientId]
  );

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setUser(null);
    setSelectedPatientIdState(null);
  }, []);

  const refreshPairingPatient = useCallback(async () => {
    if (!token || !user || parseUserRole(user.role) !== 'guardian') return;
    try {
      const { data } = await http.get<{
        paired: boolean;
        patientId?: string | null;
      }>('/pairing/status');
      if (data.paired && data.patientId) {
        persistSelectedPatient(data.patientId);
        setSelectedPatientIdState(data.patientId);
      }
    } catch {
      /* ignore */
    }
  }, [http, token, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      token,
      user,
      apiBaseUrl,
      selectedPatientId,
      guardianSocket,
      isAuthenticated: Boolean(token && user),
      http,
      setApiBaseUrl,
      setSelectedPatientId,
      login,
      register,
      logout,
      refreshPairingPatient,
    }),
    [
      loading,
      token,
      user,
      apiBaseUrl,
      selectedPatientId,
      guardianSocket,
      http,
      setApiBaseUrl,
      setSelectedPatientId,
      login,
      register,
      logout,
      refreshPairingPatient,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
