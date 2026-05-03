import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ImageSearchOutlinedIcon from '@mui/icons-material/ImageSearchOutlined';
import LinkIcon from '@mui/icons-material/Link';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDemoPhoneLayout } from '../context/DemoLayoutContext';
import { appTheme } from '../theme';

const DRAWER_WIDTH = 260;

const drawerNav = [
  { to: '/guardian', label: 'Dashboard', icon: DashboardOutlinedIcon, end: true },
  { to: '/guardian/alerts', label: 'Alerts', icon: NotificationsActiveOutlinedIcon },
  { to: '/guardian/chat', label: 'AI Chat', icon: ForumOutlinedIcon },
  { to: '/guardian/reports', label: 'Reports', icon: PictureAsPdfOutlinedIcon },
  { to: '/guardian/settings', label: 'Settings', icon: SettingsOutlinedIcon },
  { to: '/guardian/pairing', label: 'Pairing', icon: LinkIcon },
  { to: '/guardian/clinical', label: 'Daily check-in', icon: AssignmentOutlinedIcon },
  { to: '/guardian/mri', label: 'MRI upload', icon: ImageSearchOutlinedIcon },
];

const bottomTabs = [
  { value: '/guardian', label: 'Dashboard', icon: <DashboardOutlinedIcon /> },
  { value: '/guardian/alerts', label: 'Alerts', icon: <NotificationsActiveOutlinedIcon /> },
  { value: '/guardian/chat', label: 'Chat', icon: <ForumOutlinedIcon /> },
  { value: '/guardian/reports', label: 'Reports', icon: <PictureAsPdfOutlinedIcon /> },
  { value: '/guardian/settings', label: 'Settings', icon: <SettingsOutlinedIcon /> },
];

function mobileBottomNavValue(pathname: string): string {
  const secondary = ['/guardian/pairing', '/guardian/clinical', '/guardian/mri'];
  if (secondary.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return '/guardian';
  }
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const hit = bottomTabs.find((t) =>
    t.value === '/guardian' ? normalized === '/guardian' : normalized === t.value || normalized.startsWith(`${t.value}/`)
  );
  return hit?.value ?? '/guardian';
}

export function GuardianShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inDemoPhone = useDemoPhoneLayout();
  const mdUp = useMediaQuery(appTheme.breakpoints.up('md')) && !inDemoPhone;
  const [moreAnchor, setMoreAnchor] = useState<null | HTMLElement>(null);

  const drawer = useMemo(
    () => (
      <Box sx={{ pt: 2 }}>
        <Typography variant="subtitle2" sx={{ px: 2, pb: 1, color: 'text.secondary' }}>
          Signed in as {user?.fullName}
        </Typography>
        <List>
          {drawerNav.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.end}
              sx={{
                '&.active': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '& .MuiListItemIcon-root': { color: 'inherit' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <item.icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    ),
    [user?.fullName]
  );

  const mobileNavValue = mobileBottomNavValue(location.pathname);

  /** Narrow / demo phone: column layout + bottom tabs (no drawer overlap). */
  if (!mdUp) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: inDemoPhone ? 1 : undefined,
          minHeight: inDemoPhone ? 0 : '100vh',
          maxWidth: '100%',
          width: '100%',
          bgcolor: 'background.default',
          overflow: 'hidden',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <AppBar
          position="sticky"
          sx={{
            top: 0,
            flexShrink: 0,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            zIndex: (t) => t.zIndex.appBar,
          }}
        >
          <Toolbar variant="dense" disableGutters sx={{ px: 1.5, gap: 0.5 }}>
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700, fontSize: '1rem', ml: 0.5 }}>
              Dementia Guardian
            </Typography>
            <IconButton color="inherit" size="small" onClick={(e) => setMoreAnchor(e.currentTarget)} aria-label="More actions">
              <MoreVertIcon />
            </IconButton>
            <IconButton
              color="inherit"
              size="small"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              aria-label="Logout"
            >
              <LogoutRoundedIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
          <MenuItem
            onClick={() => {
              navigate('/guardian/pairing');
              setMoreAnchor(null);
            }}
          >
            Pairing
          </MenuItem>
          <MenuItem
            onClick={() => {
              navigate('/guardian/clinical');
              setMoreAnchor(null);
            }}
          >
            Daily check-in
          </MenuItem>
          <MenuItem
            onClick={() => {
              navigate('/guardian/mri');
              setMoreAnchor(null);
            }}
          >
            MRI upload
          </MenuItem>
        </Menu>

        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overflowX: 'hidden',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            p: { xs: 1.5, sm: 2 },
          }}
        >
          <Outlet />
        </Box>

        <Paper square elevation={8} sx={{ flexShrink: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <BottomNavigation
            showLabels
            value={mobileNavValue}
            onChange={(_, next) => navigate(next)}
            sx={{
              '& .MuiBottomNavigationAction-root': {
                minWidth: 0,
                px: 0.5,
              },
              '& .MuiBottomNavigationAction-label': {
                fontSize: '0.65rem',
              },
            }}
          >
            {bottomTabs.map((tab) => (
              <BottomNavigationAction key={tab.value} label={tab.label} icon={tab.icon} value={tab.value} />
            ))}
          </BottomNavigation>
        </Paper>
      </Box>
    );
  }

  /** Desktop: permanent drawer + fixed AppBar */
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default', width: '100%', overflowX: 'hidden' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            Dementia Guardian
          </Typography>
          <IconButton
            color="inherit"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogoutRoundedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        {drawer}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: '100%',
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
