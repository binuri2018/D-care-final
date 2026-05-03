import { alpha, createTheme } from '@mui/material/styles';

/** Aligns Guardian MUI with main D-care shell (`App.css` :root). */
export const dcColors = {
  bg: '#f0f5fa',
  surface: '#ffffff',
  surface2: '#e8f0f8',
  border: 'rgba(26, 58, 95, 0.12)',
  accent: '#1a6bb8',
  accentHover: '#155a9c',
  accentSoft: 'rgba(26, 107, 184, 0.1)',
  accent2: '#2d7d8a',
  accent2Dark: '#1e5a63',
  accent3: '#9a7b2c',
  danger: '#b54a4a',
  text: '#1a3348',
  text2: '#5a6f82',
  shadowSm: '0 1px 2px rgba(26, 43, 66, 0.05)',
} as const;

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: dcColors.accent,
      dark: dcColors.accentHover,
      light: '#3d8cc9',
      contrastText: '#ffffff',
    },
    secondary: {
      main: dcColors.accent2,
      dark: dcColors.accent2Dark,
      light: '#4a9bab',
      contrastText: '#ffffff',
    },
    error: { main: dcColors.danger, dark: '#943f3f' },
    warning: { main: '#b8922e', dark: '#8a6d22' },
    success: { main: '#2a7a5c', dark: '#1f5c45' },
    text: { primary: dcColors.text, secondary: dcColors.text2 },
    background: { default: dcColors.bg, paper: dcColors.surface },
    divider: dcColors.border,
  },
  typography: {
    fontFamily:
      '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          fontFamily:
            '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica", "Arial", sans-serif',
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: dcColors.surface,
          color: dcColors.text,
          backgroundImage: 'none',
          boxShadow: dcColors.shadowSm,
          borderBottom: `1px solid ${dcColors.border}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: dcColors.surface,
          borderRight: `1px solid ${dcColors.border}`,
          boxShadow: dcColors.shadowSm,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiButton: {
      styleOverrides: {
        containedPrimary: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none', backgroundColor: dcColors.accentHover },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          backgroundColor: dcColors.surface,
          borderTop: `1px solid ${dcColors.border}`,
          boxShadow: '0 -4px 20px rgba(26, 43, 66, 0.06)',
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: ({ theme }) => ({
          color: theme.palette.text.secondary,
          '&.Mui-selected': {
            color: theme.palette.primary.main,
          },
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.active': {
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            color: theme.palette.primary.main,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
            '& .MuiListItemIcon-root': { color: 'inherit' },
          },
        }),
      },
    },
  },
});
