import { createTheme } from '@mui/material/styles';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0EA5E9', dark: '#0369A1' },
    secondary: { main: '#14B8A6' },
    error: { main: '#EF4444' },
    warning: { main: '#F59E0B' },
    success: { main: '#22C55E' },
    background: {
      default: '#E8F4FC',
      paper: '#FFFFFF',
    },
  },
  typography: {
    fontFamily: '"DM Sans", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 14 },
});
