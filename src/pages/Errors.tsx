import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Brand, Button } from '../components';
export function ErrorPage({ code = 404 }: { code?: 404 | 500 }) {
  const location = useLocation();
  return <main className="error-page"><Link to="/" aria-label="DOMA — домой"><Brand /></Link><div className="error-art"><Home size={70} strokeWidth={.75} /><span>{code}</span></div><div className="eyebrow">{code === 404 ? 'НЕМНОГО СБИЛИСЬ С ПУТИ' : 'ДОМУ НУЖНА МИНУТКА'}</div><h1>{code === 404 ? 'Этой комнаты пока нет.' : 'Небольшая заминка.'}</h1><p>{code === 404 ? 'Кажется, эта страница не существует. Вернёмся туда, где хорошо?' : 'Что-то пошло не так. Ваш дом и настройки на месте — попробуйте обновить страницу.'}</p><div className="error-actions"><Link to="/" className="button button-primary"><Home size={17} />Вернуться домой</Link>{code === 500 && <Button variant="secondary" onClick={() => window.location.reload()}><RefreshCw size={17} />Обновить страницу</Button>}</div><small>DOMA · Хорошо быть дома.</small></main>;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('DOMA render error', error, info.componentStack); }
  render() { return this.state.hasError ? <ErrorPage code={500} /> : this.props.children; }
}
