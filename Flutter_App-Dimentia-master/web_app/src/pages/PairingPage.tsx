import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyIcon from '@mui/icons-material/Key';
import LinkIcon from '@mui/icons-material/Link';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../api/session';
import { useAuth } from '../context/AuthContext';

function trackingChipColor(status: string | undefined): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending':
      return 'warning';
    case 'rejected':
      return 'error';
    default:
      return 'default';
  }
}

export function PairingPage() {
  const { http, user, setSelectedPatientId } = useAuth();
  const [pairKeyInput, setPairKeyInput] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<string | undefined>();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPatient = (user?.role ?? '').toLowerCase() === 'patient';

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await http.get<{
        paired?: boolean;
        patientId?: string | null;
        trackingStatus?: string;
      }>('/pairing/status');
      const pid = data.patientId ?? null;
      setPatientId(pid);
      setTrackingStatus(data.trackingStatus);
      if (!isPatient && data.paired && pid) setSelectedPatientId(pid);
      setStatusText(data.paired ? `Pairing active. Tracking: ${data.trackingStatus ?? 'unknown'}` : 'Not paired yet.');
    } catch (e) {
      setStatusText(getErrorMessage(e));
    }
  }, [http, isPatient, setSelectedPatientId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function createKey() {
    if ((user?.role ?? '').toLowerCase() !== 'patient') {
      setStatusText('Only a patient account can create a pair key. Log out and sign in as a patient, or use Join pairing on the guardian portal.');
      return;
    }
    setLoading(true);
    setStatusText(null);
    try {
      const { data } = await http.post<{ pairKey?: string }>('/pairing/create-key', {});
      setCreatedKey(data.pairKey ?? null);
      setStatusText('Pair key created successfully.');
      await refreshStatus();
    } catch (e) {
      setStatusText(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function joinKey() {
    const key = pairKeyInput.trim().toUpperCase();
    if (!key) return;
    setLoading(true);
    setStatusText(null);
    try {
      await http.post('/pairing/join', { pairKey: key });
      setPairKeyInput('');
      setStatusText('Successfully paired.');
      await refreshStatus();
    } catch (e) {
      setStatusText(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  return (
    <Stack spacing={3} maxWidth={640}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h5" fontWeight={800} flexGrow={1}>
          Device pairing
        </Typography>
        <IconButton onClick={() => void refreshStatus()}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="subtitle2" color="text.secondary">
              Account
            </Typography>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Chip label={(user?.role ?? '').toUpperCase() || 'USER'} />
              <Typography variant="body2" color="text.secondary">
                Tracking status
              </Typography>
              <Chip label={(trackingStatus ?? 'not_requested').toUpperCase()} color={trackingChipColor(trackingStatus)} size="small" />
            </Stack>
            {patientId && (
              <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                Linked patient ID: {patientId}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {isPatient && (
        <>
          <Typography variant="subtitle1" fontWeight={700}>
            Your patient ID
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Share this ID with your guardian if they connect manually in Settings.
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            <TextField fullWidth value={user?.id ?? ''} InputProps={{ readOnly: true }} />
            <IconButton onClick={() => user?.id && copy(user.id)}>
              <ContentCopyIcon />
            </IconButton>
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>
            Generate pair key
          </Typography>
          <Button variant="contained" startIcon={<KeyIcon />} disabled={loading} onClick={() => void createKey()}>
            Create new pair key
          </Button>
          {createdKey && (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={() => copy(createdKey)}>
                  Copy
                </Button>
              }
            >
              <Typography variant="h6" letterSpacing={4}>
                {createdKey}
              </Typography>
            </Alert>
          )}
        </>
      )}

      {!isPatient && (
        <>
          <Typography variant="subtitle1" fontWeight={700}>
            Connect to patient
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Enter the code shown on the patient device.
          </Typography>
          <TextField
            label="Pair key"
            fullWidth
            value={pairKeyInput}
            onChange={(e) => setPairKeyInput(e.target.value.toUpperCase())}
            inputProps={{ style: { letterSpacing: 4, textAlign: 'center', fontSize: 22 } }}
          />
          <Button variant="contained" startIcon={<LinkIcon />} disabled={loading} onClick={() => void joinKey()}>
            Join pairing
          </Button>
        </>
      )}

      {statusText && (
        <Typography variant="body2" color="text.secondary">
          {statusText}
        </Typography>
      )}
    </Stack>
  );
}
