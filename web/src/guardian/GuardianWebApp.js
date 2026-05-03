import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { Outlet } from 'react-router-dom';
import { appTheme } from './theme.ts';

/** Theme + outlet; `AuthProvider` is at `index.js` (outside StrictMode) so Socket.IO is stable in dev. */
export default function GuardianWebApp() {
  return (
    <div className="guardian-root">
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <Outlet />
      </ThemeProvider>
    </div>
  );
}
