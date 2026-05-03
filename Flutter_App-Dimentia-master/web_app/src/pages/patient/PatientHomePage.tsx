import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';

async function readBatteryPercent(): Promise<number> {
  const g = (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery;
  if (!g) return 100;
  try {
    const b = await g();
    return Math.round(b.level * 100);
  } catch {
    return 100;
  }
}

type PendingRow = {
  _id?: string;
  guardianId?: { fullName?: string } | string;
};

export function PatientHomePage() {
  const { http, user } = useAuth();
  const navigate = useNavigate();
  const [trackingStatus, setTrackingStatus] = useState<string>('not_requested');
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  const [heartbeatOn, setHeartbeatOn] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const trackingApproved = trackingStatus === 'approved';

  const loadTracking = useCallback(async () => {
    setLoading(true);
    try {
      const [st, pend] = await Promise.all([
        http.get<{ trackingStatus?: string }>('/pairing/status'),
        http.get<PendingRow[]>('/pairing/pending-requests'),
      ]);
      setTrackingStatus(st.data.trackingStatus ?? 'not_requested');
      setPending(Array.isArray(pend.data) ? pend.data : []);
    } catch (e) {
      setStatusMsg(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [http]);

  useEffect(() => {
    void loadTracking();
  }, [loadTracking]);

  async function confirm(pairingId: string, action: 'approve' | 'reject') {
    try {
      const { data } = await http.post<{ message?: string }>('/pairing/confirm-tracking', { pairingId, action });
      setStatusMsg(data.message ?? 'Updated.');
      await loadTracking();
    } catch (e) {
      setStatusMsg(getErrorMessage(e));
    }
  }

  async function sendHeartbeatOnce() {
    if (!trackingApproved) {
      setStatusMsg('Tracking must be approved first.');
      return;
    }
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true })
      );
      let batteryLevel = 100;
      try {
        batteryLevel = await readBatteryPercent();
      } catch {
        /* ignore */
      }
      await http.post('/heartbeats', {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        batteryLevel,
      });
      setStatusMsg(`Heartbeat sent at ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      if (axios.isAxiosError(e)) setStatusMsg(getErrorMessage(e));
      else setStatusMsg('Location permission denied or unavailable.');
    }
  }

  function clearHeartbeatInterval() {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    return () => clearHeartbeatInterval();
  }, []);

  async function toggleAutoHb(on: boolean) {
    if (!trackingApproved) {
      setStatusMsg('Approve tracking before sharing location.');
      return;
    }
    setHeartbeatOn(on);
    clearHeartbeatInterval();
    if (on) {
      await sendHeartbeatOnce();
      intervalRef.current = window.setInterval(() => void sendHeartbeatOnce(), 60000);
      setStatusMsg('Auto heartbeat every 60s (keep tab open)');
    } else {
      setStatusMsg('Auto heartbeat stopped');
    }
  }

  async function sos() {
    if (sosSending) return;
    setSosSending(true);
    try {
      const { data } = await http.post<{ message?: string }>('/alerts/sos', {});
      setStatusMsg(data.message ?? 'SOS sent.');
    } catch (e) {
      setStatusMsg(getErrorMessage(e));
    } finally {
      setSosSending(false);
    }
  }

  const firstName = user?.fullName?.split(' ')?.[0] ?? 'Patient';

  return (
    <Stack spacing={3}>
      <Typography variant="h4" fontWeight={800}>
        Hello, {firstName}
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Welcome to your personal dashboard (web).
      </Typography>

      {loading ? (
        <CircularProgress />
      ) : (
        <>
          {pending.map((req) => {
            const gid = req._id ?? '';
            const g = req.guardianId;
            const guardianName = typeof g === 'object' && g?.fullName ? g.fullName : 'Your guardian';
            return (
              <Alert key={gid} severity="warning" sx={{ borderRadius: 2 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Tracking request
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  {guardianName} is asking to track your location for safety.
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Button variant="contained" color="success" onClick={() => gid && void confirm(gid, 'approve')}>
                    Allow
                  </Button>
                  <Button variant="outlined" color="error" onClick={() => gid && void confirm(gid, 'reject')}>
                    Decline
                  </Button>
                </Stack>
              </Alert>
            );
          })}

          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="h6">Location sharing</Typography>
                  <Typography variant="body2" color={trackingApproved ? 'success.main' : 'warning.main'} fontWeight={600}>
                    {trackingApproved ? 'Guardian can see location' : 'Sharing is paused'}
                  </Typography>
                </Box>
                <Switch checked={heartbeatOn} onChange={(e) => void toggleAutoHb(e.target.checked)} disabled={!trackingApproved} />
              </Stack>
              {statusMsg && (
                <Typography variant="caption" display="block" sx={{ mt: 2 }} color="text.secondary">
                  {statusMsg}
                </Typography>
              )}
              <Button sx={{ mt: 2 }} variant="outlined" disabled={!trackingApproved} fullWidth onClick={() => void sendHeartbeatOnce()}>
                Send update now
              </Button>
            </CardContent>
          </Card>

          <Card
            sx={{
              bgcolor: 'error.main',
              color: 'error.contrastText',
              textAlign: 'center',
              py: 4,
              cursor: sosSending ? 'default' : 'pointer',
            }}
            onClick={() => void sos()}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 56 }} />
            <Typography variant="h5" fontWeight={900} letterSpacing={2}>
              {sosSending ? 'Sending SOS…' : 'Emergency SOS'}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9, mt: 1 }}>
              Tap to alert your guardian
            </Typography>
          </Card>

          <Button variant="text" onClick={() => navigate('/patient/pairing')}>
            Pairing settings
          </Button>
        </>
      )}
    </Stack>
  );
}
