import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const storageKey = 'doma-smooth-effects';
const MotionPreferenceContext = createContext({ effectsEnabled: true, setEffectsEnabled: (_enabled: boolean) => {} });

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const [effectsEnabled, setEffectsEnabled] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'off'; } catch { return true; }
  });
  useEffect(() => {
    document.documentElement.dataset.motion = effectsEnabled ? 'full' : 'reduced';
    try { localStorage.setItem(storageKey, effectsEnabled ? 'on' : 'off'); } catch {}
  }, [effectsEnabled]);
  const value = useMemo(() => ({ effectsEnabled, setEffectsEnabled }), [effectsEnabled]);
  return <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>;
}

export const useMotionPreference = () => useContext(MotionPreferenceContext);
