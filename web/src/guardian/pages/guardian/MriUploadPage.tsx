import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { Alert, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { getErrorMessage } from '../../api/session.ts';
import { useAuth } from '../../context/AuthContext.tsx';

export function MriUploadPage() {
  const { http, user, selectedPatientId } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    const patientId = user?.role === 'patient' ? undefined : selectedPatientId?.trim();
    if (user?.role === 'guardian' && !patientId) {
      setResult('Select a patient ID in Settings first.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('mri', file);
      if (patientId) fd.append('patientId', patientId);
      const { data } = await http.post<{
        riskEvent?: { hybridRisk?: string };
        mri?: { classLabel?: string; mappedRisk?: string; confidence?: number };
      }>('/mri/upload', fd);
      const conf = data.mri?.confidence;
      setResult(
        [
          `Classification: ${data.mri?.classLabel ?? 'Unknown'}`,
          conf != null ? `Confidence: ${(conf * 100).toFixed(2)}%` : '',
          `MRI risk: ${data.mri?.mappedRisk ?? 'N/A'}`,
          `Hybrid risk: ${data.riskEvent?.hybridRisk ?? 'N/A'}`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (e) {
      setResult(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack spacing={3} maxWidth={560}>
      <Typography variant="h5" fontWeight={800}>
        MRI upload
      </Typography>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Button variant="outlined" onClick={() => inputRef.current?.click()}>
              Choose image
            </Button>
            {file && (
              <Typography variant="body2" color="text.secondary">
                Selected: {file.name}
              </Typography>
            )}
            <Button
              variant="contained"
              startIcon={<CloudUploadIcon />}
              disabled={!file || loading}
              onClick={() => void upload()}
            >
              Upload
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {result && (
        <Alert severity={result.includes('risk') && !result.includes('401') ? 'success' : 'info'} sx={{ whiteSpace: 'pre-wrap' }}>
          {result}
        </Alert>
      )}
    </Stack>
  );
}
