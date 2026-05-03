import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';

export function ClinicalFormPage() {
  const { http, user, selectedPatientId } = useAuth();
  const [age, setAge] = useState(70);
  const [bmi, setBmi] = useState(24);
  const [educationLevel, setEducationLevel] = useState(1);
  const [mmse, setMmse] = useState(24);
  const [functionalAssessment, setFunctionalAssessment] = useState(7);
  const [memoryComplaints, setMemoryComplaints] = useState(false);
  const [forgetfulness, setForgetfulness] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    const patientId = user?.role === 'patient' ? undefined : selectedPatientId?.trim();
    if (user?.role === 'guardian' && !patientId) {
      setStatus('Select a patient ID in Settings first.');
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        age: Math.round(age),
        bmi,
        educationLevel: Math.round(educationLevel),
        mmse: Math.round(mmse),
        functionalAssessment: Math.round(functionalAssessment),
        memoryComplaints: memoryComplaints ? 1 : 0,
        forgetfulness: forgetfulness ? 1 : 0,
      };
      if (patientId) body.patientId = patientId;
      const { data } = await http.post<{
        riskEvent?: { hybridRisk?: string };
        clinical?: { modelProbability?: number; mappedRisk?: string };
      }>('/clinical-form', body);
      const prob = data.clinical?.modelProbability;
      setStatus(
        [
          'Submitted successfully.',
          prob != null ? `Probability: ${prob.toFixed(3)}` : '',
          `Clinical risk: ${data.clinical?.mappedRisk ?? 'N/A'}`,
          `Hybrid risk: ${data.riskEvent?.hybridRisk ?? 'N/A'}`,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (e) {
      setStatus(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack spacing={3} maxWidth={560}>
      <Typography variant="h5" fontWeight={800}>
        Daily check-in
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Same fields as the mobile clinical assessment.
      </Typography>
      {status && (
        <Alert severity={status.startsWith('Submitted') ? 'success' : 'error'} sx={{ whiteSpace: 'pre-wrap' }}>
          {status}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Demographics
          </Typography>
          <Typography variant="caption">Age: {Math.round(age)} yrs</Typography>
          <Slider min={50} max={95} value={age} onChange={(_, v) => setAge(v as number)} />
          <Typography variant="caption">BMI: {bmi.toFixed(1)}</Typography>
          <Slider min={10} max={45} step={0.1} value={bmi} onChange={(_, v) => setBmi(v as number)} />
          <Typography variant="caption">Education level: {Math.round(educationLevel)} tier</Typography>
          <Slider min={0} max={3} step={1} marks value={educationLevel} onChange={(_, v) => setEducationLevel(v as number)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            Cognitive & functional
          </Typography>
          <Typography variant="caption">MMSE: {Math.round(mmse)} pts</Typography>
          <Slider min={0} max={30} value={mmse} onChange={(_, v) => setMmse(v as number)} />
          <Typography variant="caption">Functional assessment: {Math.round(functionalAssessment)} lvl</Typography>
          <Slider min={0} max={10} value={functionalAssessment} onChange={(_, v) => setFunctionalAssessment(v as number)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <FormControlLabel
            control={<Switch checked={memoryComplaints} onChange={(e) => setMemoryComplaints(e.target.checked)} />}
            label="Memory complaints"
          />
          <Divider sx={{ my: 1 }} />
          <FormControlLabel
            control={<Switch checked={forgetfulness} onChange={(e) => setForgetfulness(e.target.checked)} />}
            label="Observed forgetfulness"
          />
        </CardContent>
      </Card>

      <Box>
        <Button variant="contained" size="large" fullWidth disabled={loading} onClick={() => void submit()}>
          Submit assessment
        </Button>
      </Box>
    </Stack>
  );
}
