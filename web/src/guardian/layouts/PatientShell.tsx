import { AppBar, Box, IconButton, Toolbar, Typography } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { Outlet, useNavigate } from 'react-router-dom';
import { useDemoPhoneLayout } from '../context/DemoLayoutContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { GUARDIAN_BASE } from '../paths.ts';

export function PatientShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const inDemoPhone = useDemoPhoneLayout();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: inDemoPhone ? 0 : '100vh',
        flex: inDemoPhone ? 1 : undefined,
        bgcolor: 'background.default',
        overflow: inDemoPhone ? 'hidden' : undefined,
        minWidth: 0,
      }}
    >
      <AppBar position="sticky" sx={{ flexShrink: 0 }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            My Space
          </Typography>
          <Typography variant="body2" sx={{ mr: 2, display: { xs: 'none', sm: 'block' } }}>
            {user?.fullName}
          </Typography>
          <IconButton color="inherit" onClick={() => navigate('pairing')} title="Pairing">
            <LinkIcon />
          </IconButton>
          <IconButton
            color="inherit"
            onClick={() => {
              logout();
              navigate(`${GUARDIAN_BASE}/login`);
            }}
          >
            <LogoutRoundedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: { xs: 2, md: 3 }, flex: inDemoPhone ? 1 : undefined, overflow: inDemoPhone ? 'auto' : undefined, minHeight: 0 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
