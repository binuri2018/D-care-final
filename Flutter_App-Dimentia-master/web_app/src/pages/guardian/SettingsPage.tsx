import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createHttp, getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';

export function SettingsPage() {
  const { user, apiBaseUrl, selectedPatientId, setApiBaseUrl, setSelectedPatientId, token } = useAuth();
  const navigate = useNavigate();
  const [apiField, setApiField] = useState(apiBaseUrl);
  const [patientField, setPatientField] = useState(selectedPatientId ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  useEffect(() => {
    setApiField(apiBaseUrl);
  }, [apiBaseUrl]);

  useEffect(() => {
    setPatientField(selectedPatientId ?? '');
  }, [selectedPatientId]);

  async function save() {
    setMsg(null);
    setError(null);
    setApiBaseUrl(apiField.trim());
    setSelectedPatientId(patientField.trim() || null);
    setMsg('Settings saved.');
  }

  async function requestTracking() {
    const patientId = patientField.trim();
    if (!patientId) {
      setError('Enter a patient ID first.');
      return;
    }
    setTrackingLoading(true);
    setError(null);
    try {
      setApiBaseUrl(apiField.trim());
      setSelectedPatientId(patientField.trim() || null);
      const client = createHttp(apiField.trim(), token);
      const { data } = await client.post<{ message?: string }>('/pairing/request-tracking', { patientId });
      setMsg(data.message ?? 'Tracking request sent.');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setTrackingLoading(false);
    }
  }

  return (
    <Stack spacing={3} maxWidth={560}>
      <Typography variant="h5" fontWeight={800}>
        Settings
      </Typography>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56 }}>
              {(user?.fullName?.[0] ?? 'U').toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {user?.fullName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user?.email}
              </Typography>
              <Typography variant="caption" textTransform="uppercase">
                {user?.role}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {msg && <Alert severity="success">{msg}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Typography variant="overline" color="primary">
        API
      </Typography>
      <TextField
        label="API base URL"
        fullWidth
        value={apiField}
        onChange={(e) => setApiField(e.target.value)}
        helperText="Example: http://localhost:4000/api"
      />

      <Divider />

      <Typography variant="overline" color="primary">
        Guardian patient
      </Typography>
      <TextField
        label="Selected patient ID"
        fullWidth
        value={patientField}
        onChange={(e) => setPatientField(e.target.value)}
        helperText="Usually filled automatically after pairing."
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Button variant="contained" onClick={() => void save()}>
          Save
        </Button>
        <Button variant="outlined" disabled={trackingLoading} onClick={() => void requestTracking()}>
          Request tracking approval
        </Button>
        <Button variant="text" onClick={() => navigate('/guardian/pairing')}>
          Open pairing
        </Button>
      </Stack>
    </Stack>
  );
}
