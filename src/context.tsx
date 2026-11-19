import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot, User } from '../shared/types';
import { api, ApiError, getSnapshot, send, setCsrf, type AuthResponse } from './api';

type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' };
type AppContextValue = {
  user: User | null; snapshot: Snapshot | null; booting: boolean; homeLoading: boolean; error: string | null;
  toasts: Toast[]; dismissToast: (id: number) => void; notify: (message: string, tone?: Toast['tone']) => void;
  authenticate: (kind: 'login' | 'register' | 'demo', values: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>; refresh: () => Promise<void>; switchHome: (id: number) => Promise<void>;
  mutate: <T>(path: string, method: string, body?: unknown, success?: string) => Promise<T>;
  updateUser: (user: User) => void;
};
const AppContext = createContext<AppContextValue | null>(null);
export const useApp = () => { const value = useContext(AppContext); if (!value) throw new Error('App context unavailable'); return value; };
export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [booting, setBooting] = useState(true);
  const [homeLoading, setHomeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const homeRef = useRef<number | undefined>(undefined);
  const userRef = useRef<User | null>(null);
  const requestRef = useRef(0);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(previous => [...previous.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts(previous => previous.filter(item => item.id !== id)), tone === 'error' ? 8000 : 4500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(previous => previous.filter(item => item.id !== id)), []);
  const updateUser = useCallback((next: User) => { userRef.current = next; setUser(next); setSnapshot(previous => previous ? { ...previous, user: next } : previous); }, []);
  const loadHome = useCallback(async (homeId?: number, quiet = false) => {
    const request = ++requestRef.current;
    if (!quiet) setHomeLoading(true);
    try {
      const result = await getSnapshot(homeId);
      if (request !== requestRef.current) return;
      homeRef.current = result.home.id;
      userRef.current = result.user;
      setSnapshot(result); setUser(result.user); setError(null);
    } catch (err) {
      if (request !== requestRef.current) return;
      if (err instanceof ApiError && err.status === 401) { setUser(null); userRef.current = null; setSnapshot(null); setCsrf(null); homeRef.current = undefined; }
      else setError(err instanceof Error ? err.message : 'Не удалось загрузить дом');
      if (!quiet) throw err;
    } finally { if (request === requestRef.current && !quiet) setHomeLoading(false); }
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const auth = await api<AuthResponse>('/api/auth/me');
        if (!mounted) return;
        setCsrf(auth.csrf); setUser(auth.user); userRef.current = auth.user;
        if (auth.user) await loadHome();
      } catch (err) { if (mounted) setError(err instanceof Error ? err.message : 'Не удалось подключиться'); }
      finally { if (mounted) setBooting(false); }
    })();
    return () => { mounted = false; };
  }, [loadHome]);
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible' && userRef.current) void loadHome(homeRef.current, true); }, 20000);
    return () => window.clearInterval(id);
  }, [user?.id, loadHome]);
  const authenticate = useCallback(async (kind: 'login' | 'register' | 'demo', values: Record<string, string>) => {
    const auth = await send<AuthResponse>(`/api/auth/${kind}`, 'POST', values);
    setCsrf(auth.csrf); setUser(auth.user); userRef.current = auth.user;
    if (auth.user) await loadHome();
  }, [loadHome]);
  const logout = useCallback(async () => {
    try { await send('/api/auth/logout', 'POST', {}); requestRef.current++; setCsrf(null); setUser(null); userRef.current = null; setSnapshot(null); homeRef.current = undefined; setError(null); }
    catch (err) { notify(err instanceof Error ? err.message : 'Не удалось выйти', 'error'); throw err; }
  }, [notify]);
  const refresh = useCallback(() => loadHome(homeRef.current), [loadHome]);
  const switchHome = useCallback((id: number) => loadHome(id), [loadHome]);
  const mutate = useCallback(async <T,>(path: string, method: string, body?: unknown, success?: string): Promise<T> => {
    try {
      const result = await send<T>(path, method, body);
      if (success) notify(success);
      if (userRef.current) await loadHome(homeRef.current, true);
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { requestRef.current++; setUser(null); userRef.current = null; setSnapshot(null); setCsrf(null); }
      notify(err instanceof Error ? err.message : 'Не удалось сохранить изменения', 'error'); throw err;
    }
  }, [loadHome, notify]);
  return <AppContext.Provider value={{ user, snapshot, booting, homeLoading, error, toasts, dismissToast, notify, authenticate, logout, refresh, switchHome, mutate, updateUser }}>{children}</AppContext.Provider>;
}
