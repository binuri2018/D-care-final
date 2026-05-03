import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';

type RiskCurrent = {
  hybridRisk?: string;
  weightedScore?: number;
  highStreakDays?: number;
  createdAt?: string;
};

function riskColor(level: string | undefined): 'error' | 'warning' | 'success' {
  const l = (level || '').toLowerCase();
  if (l === 'high' || l === 'critical') return 'error';
  if (l === 'medium') return 'warning';
  return 'success';
}

function parseCoord(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function DashboardPage() {
  const { http, selectedPatientId, refreshPairingPatient } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskCurrent | null>(null);
  const [heartbeat, setHeartbeat] = useState<Record<string, unknown> | null>(null);
  const [trendRows, setTrendRows] = useState<Array<{ index: number; modelProbability: number }>>([]);

  useEffect(() => {
    refreshPairingPatient();
  }, [refreshPairingPatient]);

  const loadData = useCallback(
    async (silent?: boolean) => {
      const patientId = selectedPatientId?.trim();
      if (!patientId) {
        if (!silent) setLoading(false);
        setError(null);
        setInfo('Set selected patient ID in Settings or complete pairing.');
        setRisk(null);
        setHeartbeat(null);
        setTrendRows([]);
        return;
      }

      if (!silent) {
        setLoading(true);
        setError(null);
        setInfo(null);
      }

      let nextError: string | null = null;
      let nextInfo: string | null = null;
      let nextRisk: RiskCurrent | null = null;
      let nextHb: Record<string, unknown> | null = null;
      let nextTrend: Array<{ index: number; modelProbability: number }> = [];

      try {
        const { data } = await http.get<unknown[]>(`/clinical-form/trends/${patientId}`);
        nextTrend = (Array.isArray(data) ? data : []).map((row, i) => ({
          index: i,
          modelProbability: Number((row as { modelProbability?: number }).modelProbability ?? 0),
        }));
      } catch (e) {
        nextError = getErrorMessage(e);
      }

      try {
        const { data } = await http.get<RiskCurrent>(`/risk/current/${patientId}`);
        nextRisk = data?.createdAt != null || data?.hybridRisk != null ? data : null;
      } catch (e) {
        if (!axios.isAxiosError(e) || e.response?.status !== 404) {
          const msg = getErrorMessage(e);
          if (msg.includes('pending patient approval')) nextInfo = 'Tracking is pending patient approval.';
          else if (!nextError) nextError = msg;
        }
      }

      try {
        const { data } = await http.get<Record<string, unknown>>(`/heartbeats/latest/${patientId}`);
        nextHb = data?.createdAt != null ? data : null;
      } catch (e) {
        if (!axios.isAxiosError(e) || e.response?.status !== 404) {
          const msg = getErrorMessage(e);
          if (msg.includes('pending patient approval')) nextInfo = 'Tracking is pending patient approval.';
          else if (!nextError) nextError = msg;
        }
      }

      const hasAny = nextRisk != null || nextHb != null || nextTrend.length > 0;
      if (!hasAny && !nextInfo && !nextError) {
        nextInfo = 'No patient data yet. Start with check-in, MRI upload, and heartbeat.';
      }

      setTrendRows(nextTrend);
      setRisk(nextRisk);
      setHeartbeat(nextHb);
      setError(nextError);
      setInfo(nextInfo);
      if (!silent) setLoading(false);
    },
    [http, selectedPatientId]
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadData(true);
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadData]);

  const locationLine = useMemo(() => {
    if (!heartbeat) return 'Lat/Lng: -- | Updated: --';
    const createdAt = heartbeat.createdAt?.toString();
    const lat = parseCoord(heartbeat.latitude);
    const lng = parseCoord(heartbeat.longitude);
    const t = createdAt ? new Date(createdAt).toLocaleString() : '--';
    if (lat == null || lng == null) return `Lat/Lng: missing | Updated: ${t}`;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return `Lat/Lng invalid | Updated: ${t}`;
    return `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)} | Updated: ${t}`;
  }, [heartbeat]);

  const mapsUrl = useMemo(() => {
    const lat = parseCoord(heartbeat?.latitude);
    const lng = parseCoord(heartbeat?.longitude);
    if (lat == null || lng == null) return null;
    if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return null;
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }, [heartbeat]);

  const chartData = trendRows.map(({ index, modelProbability }) => ({
    name: String(index + 1),
    p: modelProbability,
  }));

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Box>
          <Typography variant="h5" fontWeight={800}>
            Command Center
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Patient overview and tracking
          </Typography>
        </Box>
        <Box flexGrow={1} />
        <IconButton onClick={() => void loadData()} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {info && <Alert severity="info">{info}</Alert>}

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h6">Real-time location</Typography>
            {risk?.hybridRisk && (
              <Chip label={`${risk.hybridRisk.toUpperCase()} risk`} color={riskColor(risk.hybridRisk)} size="small" />
            )}
          </Stack>
          <Box
            sx={{
              height: 180,
              borderRadius: 2,
              bgcolor: 'action.hover',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 1,
            }}
          >
            <Typography color="text.secondary" align="center" sx={{ px: 2 }}>
              {mapsUrl ? 'Location available — open in Google Maps.' : 'Patient heartbeat will appear here.'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            {locationLine}
          </Typography>
          <Button component="a" href={mapsUrl ?? '#'} disabled={!mapsUrl} variant="outlined" target="_blank" rel="noreferrer">
            Open in Google Maps
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Cognitive decline trend
          </Typography>
          <Box sx={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="name" hide />
                <YAxis domain={[0, 1]} width={36} />
                <Tooltip />
                <Line type="monotone" dataKey="p" stroke="#0EA5E9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="h6" fontWeight={700}>
        Quick actions
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Upload MRI
            </Typography>
            <Button variant="contained" fullWidth onClick={() => navigate('/guardian/mri')}>
              Open
            </Button>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Daily check-in
            </Typography>
            <Button variant="contained" color="secondary" fullWidth onClick={() => navigate('/guardian/clinical')}>
              Open
            </Button>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Pairing
            </Typography>
            <Button variant="outlined" fullWidth onClick={() => navigate('/guardian/pairing')}>
              Open
            </Button>
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}
