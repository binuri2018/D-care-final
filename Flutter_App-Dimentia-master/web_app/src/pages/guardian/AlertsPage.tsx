import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeAlerts } from '../../hooks/useRealtimeAlerts';

type AlertRow = {
  _id: string;
  type?: string;
  severity?: string;
  message?: string;
  acknowledged?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export function AlertsPage() {
  const { http, selectedPatientId } = useAuth();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params =
        selectedPatientId && selectedPatientId.trim()
          ? { patientId: selectedPatientId.trim() }
          : undefined;
      const { data } = await http.get<AlertRow[]>('/alerts', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [http, selectedPatientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReload = useCallback(() => void load(), [load]);
  useRealtimeAlerts(onReload);

  async function ack(id: string) {
    try {
      await http.post(`/alerts/${id}/ack`, {});
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function ackAll() {
    try {
      await http.post('/alerts/ack-all', {
        patientId: selectedPatientId?.trim() || undefined,
      });
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h5" fontWeight={800} flexGrow={1}>
          Alerts
        </Typography>
        <IconButton onClick={() => void load()} disabled={loading}>
          <RefreshIcon />
        </IconButton>
        <Button startIcon={<DoneAllIcon />} variant="outlined" onClick={() => void ackAll()} disabled={loading}>
          Mark all read
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {loading && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}

      {!loading && rows.length === 0 && (
        <Typography color="text.secondary">No alerts yet.</Typography>
      )}

      <List sx={{ bgcolor: 'background.paper', borderRadius: 2 }}>
        {rows.map((a, i) => (
          <Box key={a._id}>
            {i > 0 && <Divider component="li" />}
            <ListItem
              secondaryAction={
                !a.acknowledged && (
                  <IconButton edge="end" onClick={() => void ack(a._id)} title="Acknowledge">
                    <CheckCircleOutlineIcon />
                  </IconButton>
                )
              }
            >
              <Card variant="outlined" sx={{ width: '100%', mr: a.acknowledged ? 0 : 6 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Chip size="small" label={(a.severity || 'info').toUpperCase()} />
                    <Typography variant="caption" color="text.secondary">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}
                    </Typography>
                  </Stack>
                  <Typography variant="body2">{a.message}</Typography>
                  {a.type && (
                    <Typography variant="caption" color="text.secondary">
                      {a.type}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </ListItem>
          </Box>
        ))}
      </List>
    </Stack>
  );
}
