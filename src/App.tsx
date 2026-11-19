import { lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppProvider, useApp } from './context';
import { Brand, Loader, Toasts } from './components';
import { SmoothScroll } from './components/SmoothScroll';
import { PageTransition } from './components/PageTransition';
import { MotionPreferenceProvider, useMotionPreference } from './motionPreference';
import Layout from './Layout';
const Auth = lazy(() => import('./pages/Auth'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Lighting = lazy(() => import('./pages/Lighting'));
const Climate = lazy(() => import('./pages/Climate'));
const Scenes = lazy(() => import('./pages/Scenes'));
const Activity = lazy(() => import('./pages/Activity'));
const Admin = lazy(() => import('./pages/Admin'));
import { ErrorBoundary, ErrorPage } from './pages/Errors';
const titles: Record<string, string> = { '/': 'Обзор дома', '/lighting': 'Освещение', '/climate': 'Климат', '/scenes': 'Сценарии', '/activity': 'Активность', '/admin': 'Администрирование', '/login': 'Добро пожаловать', '/404': 'Страница не найдена', '/500': 'Небольшая заминка' };
function AppRoutes() {
  const { user, booting } = useApp(); const location = useLocation();
  useEffect(() => { document.title = `${titles[location.pathname] || 'Хорошо быть дома'} — DOMA`; }, [location.pathname]);
  if (booting) return <div className="boot-screen"><Brand /><Loader /></div>;
  return <><Routes><Route path="/login" element={<PageTransition routeKey="login"><Auth /></PageTransition>} /><Route path="/404" element={<PageTransition routeKey="404"><ErrorPage /></PageTransition>} /><Route path="/500" element={<PageTransition routeKey="500"><ErrorPage code={500} /></PageTransition>} /><Route element={user ? <Layout /> : <Navigate to="/login" replace />}><Route index element={<Dashboard />} /><Route path="lighting" element={<Lighting />} /><Route path="climate" element={<Climate />} /><Route path="scenes" element={<Scenes />} /><Route path="activity" element={<Activity />} /><Route path="admin" element={<Admin />} /></Route><Route path="*" element={<PageTransition routeKey={location.pathname}><ErrorPage /></PageTransition>} /></Routes><Toasts /></>;
}
function MotionRoot() { const { effectsEnabled } = useMotionPreference(); return <MotionConfig reducedMotion={effectsEnabled ? 'never' : 'always'}><SmoothScroll><AppProvider><AppRoutes /></AppProvider></SmoothScroll></MotionConfig>; }
export default function App() { return <BrowserRouter><ErrorBoundary><MotionPreferenceProvider><MotionRoot /></MotionPreferenceProvider></ErrorBoundary></BrowserRouter>; }
