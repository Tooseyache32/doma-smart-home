import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import Lenis from 'lenis';
import { isScrollLocked, subscribeScrollLock } from '../scrollLock';
import { useMotionPreference } from '../motionPreference';
import 'lenis/dist/lenis.css';

const ScrollContext = createContext({ resetScroll: () => {}, cancelMomentum: () => {} });
export const useSmoothScroll = () => useContext(ScrollContext);

export function SmoothScroll({ children }: { children: ReactNode }) {
  const { effectsEnabled } = useMotionPreference();
  const instance = useRef<Lenis | null>(null);
  const cancelMomentum = useCallback(() => {
    instance.current?.scrollTo(window.scrollY, { immediate: true, force: true });
  }, []);
  const resetScroll = useCallback(() => {
    if (instance.current) instance.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    if (!effectsEnabled) return;
    const lenis = new Lenis({
      respectReducedMotion: false,
      autoRaf: true,
      lerp: .085,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: .9,
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      prevent: node => node.matches('.sidebar, .modal-overlay, .modal, .table-scroll, .readings-table, .admin-tabs, .filter-pills, input, textarea, select, [data-native-scroll]'),
      virtualScroll: ({ event }) => !(event instanceof WheelEvent && (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))),
    });
    instance.current = lenis;
    const syncLock = () => { if (isScrollLocked()) lenis.stop(); else lenis.start(); };
    const unsubscribe = subscribeScrollLock(syncLock);
    syncLock();
    const nativeKeys = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelMomentum();
    };
    const focus = () => cancelMomentum();
    window.addEventListener('keydown', nativeKeys);
    document.addEventListener('focusin', focus);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', nativeKeys);
      document.removeEventListener('focusin', focus);
      instance.current = null;
      lenis.destroy();
    };
  }, [effectsEnabled, cancelMomentum]);

  return <ScrollContext.Provider value={{ resetScroll, cancelMomentum }}>{children}</ScrollContext.Provider>;
}
