import {
  Alert,
  Box,
  Button,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { getErrorMessage } from '../api/session.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useDemoPhoneLayout } from '../context/DemoLayoutContext.tsx';
import { GUARDIAN_BASE } from '../paths.ts';
import { dcColors } from '../theme.ts';

export function LoginPage() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const demoPhone = useDemoPhoneLayout();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const signedIn = await login(email.trim(), password);
      navigate(
        signedIn.role === 'guardian' ? `${GUARDIAN_BASE}/guardian` : `${GUARDIAN_BASE}/patient`,
        { replace: true }
      );
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
        background: `linear-gradient(165deg, ${dcColors.accent} 0%, ${dcColors.accentHover} 42%, ${dcColors.bg} 42%)`,
        p: 2,
        overflow: demoPhone ? 'auto' : undefined,
      }}
    >
      <Container maxWidth="sm">
        <Paper elevation={0} sx={{ p: { xs: 3, sm: 4 }, borderRadius: '12px', border: `1px solid ${dcColors.border}`, boxShadow: '0 12px 40px rgba(26, 43, 66, 0.08)' }}>
          <Typography variant="h5" gutterBottom fontWeight={800}>
            Welcome back
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in with the same account as the mobile app.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={submit}>
            <Stack spacing={2}>
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
                autoComplete="current-password"
                required
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="contained" size="large" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
              <Typography variant="body2">
                No account?{' '}
                <Link component={RouterLink} to={`${GUARDIAN_BASE}/register`}>
                  Register
                </Link>
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
