import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import axios from 'axios';
import { useState } from 'react';
import { getErrorMessage, socketOriginFromApiBase } from '../../api/session.ts';
import { useAuth } from '../../context/AuthContext.tsx';

export function ReportsPage() {
  const { http, apiBaseUrl, selectedPatientId, token } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Ready to generate report.');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const patientId = selectedPatientId?.trim();
    if (!patientId) {
      setError('Please select a patient ID in Settings first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await http.post<{ downloadUrl?: string }>('/reports/generate', {
        patientId,
        triggerSource: 'guardian-portal',
      });
      setDownloadUrl(data.downloadUrl ?? null);
      setStatus('Report generated successfully.');
    } catch (e) {
      setStatus(getErrorMessage(e));
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    if (!downloadUrl) return;
    const origin = socketOriginFromApiBase(apiBaseUrl);
    const absolute = downloadUrl.startsWith('http') ? downloadUrl : `${origin}${downloadUrl}`;
    try {
      const res = await axios.get(absolute, {
        responseType: 'blob',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dementia_report_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <Stack spacing={3} maxWidth={560}>
      <Typography variant="h5" fontWeight={800}>
        Reports
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Generate a PDF summary for the selected patient (same API as the mobile app).
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography>{status}</Typography>
            <TextField
              label="Email (optional)"
              type="email"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              helperText="Optional — email sending can be wired later."
              disabled
            />
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <PictureAsPdfOutlinedIcon />}
                onClick={() => void generate()}
                disabled={loading}
              >
                Generate report
              </Button>
              <Button variant="outlined" disabled={!downloadUrl} onClick={() => void downloadPdf()}>
                Download PDF
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
