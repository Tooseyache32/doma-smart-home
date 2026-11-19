import { Suspense, useLayoutEffect, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useMotionPreference } from '../motionPreference';
import { Loader } from '../components';
import { useSmoothScroll } from './SmoothScroll';

function RouteEntry({ children }: { children: ReactNode }) {
  const { effectsEnabled } = useMotionPreference();
  const present = useIsPresent();
  const { resetScroll } = useSmoothScroll();
  useLayoutEffect(() => resetScroll(), [resetScroll]);
  return <motion.div
    className="route-content"
    initial={effectsEnabled ? { opacity: 0, y: 10 } : false}
    animate={{ opacity: 1, y: 0, transition: { duration: effectsEnabled ? .52 : 0, ease: [.16, 1, .3, 1] } }}
    exit={{ opacity: effectsEnabled ? 0 : 1, y: effectsEnabled ? -6 : 0, transition: { duration: effectsEnabled ? .18 : 0, ease: [.4, 0, 1, 1] } }}
    style={{ pointerEvents: present ? 'auto' : 'none' }}
    inert={!present}
  >{children}</motion.div>;
}

function RouteFrame({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loader label="Готовим ваше пространство…" />}><RouteEntry>{children}</RouteEntry></Suspense>;
}

export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const { cancelMomentum } = useSmoothScroll();
  useLayoutEffect(() => cancelMomentum(), [routeKey, cancelMomentum]);
  return <AnimatePresence mode="wait"><RouteFrame key={routeKey}>{children}</RouteFrame></AnimatePresence>;
}
