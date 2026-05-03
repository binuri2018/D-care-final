import { Box } from '@mui/material';
import type { ReactNode } from 'react';

/** Fixed “device” size (CSS px) — same on every route when ?demo=1 */
export const DEMO_PHONE_WIDTH = 300;
export const DEMO_PHONE_HEIGHT = 650;

/** Viva-friendly phone chrome. Use ?demo=1 in the URL. */
export function DemoPhoneFrame({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        bgcolor: '#141414',
        boxSizing: 'border-box',
        py: { xs: 2, sm: 3 },
        px: { xs: 1, sm: 2 },
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'auto',
      }}
    >
      <Box
        sx={{
          width: DEMO_PHONE_WIDTH,
          height: DEMO_PHONE_HEIGHT,
          flexShrink: 0,
          borderRadius: '22px',
          border: '6px solid #2a2a2a',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 24px 56px rgba(0,0,0,0.55)',
          overflow: 'hidden',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          transform: 'translateZ(0)',
          isolation: 'isolate',
        }}
      >
        <Box
          sx={{
            height: 22,
            flexShrink: 0,
            bgcolor: '#2a2a2a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ width: 72, height: 16, borderRadius: '8px', bgcolor: '#0d0d0d' }} />
        </Box>
        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
