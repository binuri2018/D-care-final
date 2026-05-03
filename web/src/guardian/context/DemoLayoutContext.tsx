import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const DemoLayoutContext = createContext(false);

export function DemoLayoutProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <DemoLayoutContext.Provider value={value}>{children}</DemoLayoutContext.Provider>;
}

/** True when ?demo=1 phone frame is active (session persists flag). */
export function useDemoPhoneLayout(): boolean {
  return useContext(DemoLayoutContext);
}
