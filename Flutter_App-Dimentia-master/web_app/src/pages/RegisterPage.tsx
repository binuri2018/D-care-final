import {
  Alert,
  Box,
  Button,
  Container,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { getErrorMessage } from '../api/session';
import { useAuth } from '../context/AuthContext';
import { useDemoPhoneLayout } from '../context/DemoLayoutContext';

export function RegisterPage() {
  const { register, loading } = useAuth();
  const navigate = useNavigate();
  const demoPhone = useDemoPhoneLayout();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'patient' | 'guardian'>('guardian');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const signedUp = await register({ fullName: fullName.trim(), email: email.trim(), password, role });
      navigate(signedUp.role === 'guardian' ? '/guardian' : '/patient', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <Box
      sx={{
        ...(demoPhone ? { flex: 1, minHeight: 0 } : { minHeight: '100vh' }),
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(165deg, #14B8A6 0%, #0F766E 45%, #E8F4FC 45%)',
        p: 2,
        overflow: demoPhone ? 'auto' : undefined,
      }}
    >
      <Container maxWidth="sm">
        <Paper elevation={6} sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
          <Typography variant="h5" gutterBottom fontWeight={800}>
            Create account
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Choose Patient or Guardian — matches the mobile roles.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label="Full name"
                required
                fullWidth
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                required
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="new-password"
                required
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="At least 6 characters"
              />
              <FormControl fullWidth>
                <InputLabel id="role-label">Role</InputLabel>
                <Select
                  labelId="role-label"
                  label="Role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'patient' | 'guardian')}
                >
                  <MenuItem value="guardian">Guardian</MenuItem>
                  <MenuItem value="patient">Patient</MenuItem>
                </Select>
              </FormControl>
              <Button type="submit" variant="contained" size="large" disabled={loading}>
                {loading ? 'Creating…' : 'Register'}
              </Button>
              <Typography variant="body2">
                Already registered?{' '}
                <Link component={RouterLink} to="/login">
                  Sign in
                </Link>
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
