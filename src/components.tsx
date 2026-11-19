import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, ChevronRight, Coffee, Film, Home, Leaf, LoaderCircle, Moon, Sun, X, type LucideIcon } from 'lucide-react';
import { acquireScrollLock } from './scrollLock';
import { useApp } from './context';
import { ApiError, dateTime } from './api';
import type { Event, IconName, Reading } from '../shared/types';

export function Brand({ light = false }: { light?: boolean }) { return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-icon"><Home size={22} strokeWidth={1.7} /></span><span>DOMA<span className="brand-dot">.</span></span></div>; }
export function Button({ children, variant = 'primary', loading, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean }) { return <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || loading}>{loading && <LoaderCircle size={17} className="spin" />}{children}</button>; }
export function IconButton({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) { return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }
export function Field({ label, error, hint, children, className = '' }: { label: string; error?: string; hint?: string; children: ReactNode; className?: string }) { return <div className={`field ${error ? 'field-invalid' : ''} ${className}`}><label>{label}{children}</label>{error && <span className="field-error" role="alert">{error}</span>}{hint && !error && <span className="field-hint">{hint}</span>}</div>; }
export function FormError({ error }: { error: string | null | undefined }) { return error ? <div className="form-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div> : null; }
export function useFormStatus() {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(null); setFields({}); try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить'); if (err instanceof ApiError) setFields(err.fields); } finally { setBusy(false); } };
  return { busy, error, fields, setError, setFields, run };
}
const dialogStack: string[] = [];
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId(); const ref = useRef<HTMLDivElement>(null); const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const releaseScroll = acquireScrollLock();
    dialogStack.push(titleId);
    const getFocusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
    const timer = window.setTimeout(() => (ref.current?.querySelector<HTMLElement>('[autofocus]') || getFocusable()[1] || getFocusable()[0] || ref.current)?.focus(), 0);
    const key = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== titleId) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') { const items = getFocusable(); const first = items[0]; const last = items[items.length - 1]; if (!first) { event.preventDefault(); ref.current?.focus(); } else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', key); const wasTop = dialogStack[dialogStack.length - 1] === titleId; const index = dialogStack.indexOf(titleId); if (index >= 0) dialogStack.splice(index, 1); if (wasTop && previous?.isConnected) previous.focus({ preventScroll: true }); releaseScroll(); };
  }, []);
  return createPortal(<div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Закрыть окно" onClick={onClose}><X size={20} /></IconButton></div>{children}</div></div>, document.body);
}
export function ConfirmDialog({ title, message, onConfirm, onClose, confirmText = 'Удалить', danger = true }: { title: string; message: ReactNode; onConfirm: () => Promise<void>; onClose: () => void; confirmText?: string; danger?: boolean }) {
  const form = useFormStatus();
  return <Modal title={title} onClose={onClose}><div className="confirm-text">{message}</div><FormError error={form.error} /><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Отмена</Button><Button variant={danger ? 'danger' : 'primary'} loading={form.busy} onClick={() => void form.run(async () => { await onConfirm(); onClose(); })}>{confirmText}</Button></div></Modal>;
}
export function Toggle({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>; }
export function Range({ label, value, min, max, step = 1, suffix = '', onCommit, disabled = false }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onCommit: (value: number) => void; disabled?: boolean }) {
  const [local, setLocal] = useState(value); useEffect(() => setLocal(value), [value]);
  const commit = () => { if (local !== value) onCommit(local); };
  return <label className="range-field"><span className="range-heading"><span>{label}</span><strong>{local.toLocaleString('ru-RU')}{suffix}</strong></span><input type="range" aria-label={label} aria-valuetext={`${local}${suffix}`} min={min} max={max} step={step} value={local} disabled={disabled} onChange={event => setLocal(Number(event.target.value))} onPointerUp={commit} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit(); }} onBlur={commit} style={{ '--range-fill': `${((local - min) / (max - min)) * 100}%` } as React.CSSProperties} /></label>;
}
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { return <header className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>; }
export function Page({ children }: { children: ReactNode }) { return <div className="page">{children}</div>; }
export function Empty({ icon: Icon = Home, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Icon size={28} strokeWidth={1.4} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }
export function Loader({ label = 'Подключаемся к вашему дому…' }: { label?: string }) { return <div className="loader-state"><LoaderCircle size={27} className="spin" /><p>{label}</p></div>; }
export const sceneIcons: Record<IconName, LucideIcon> = { sun: Sun, home: Home, moon: Moon, film: Film, coffee: Coffee, leaf: Leaf };
export function SceneIcon({ icon, size = 22 }: { icon: IconName; size?: number }) { const Icon = sceneIcons[icon] || Home; return <Icon size={size} strokeWidth={1.6} />; }
export function EventList({ events, limit }: { events: Event[]; limit?: number }) { return <div className="event-list">{events.slice(0, limit ?? events.length).map(event => <div className="event-row" key={event.id}><span className={`event-icon ${event.severity === 'warning' || event.severity === 'critical' || event.severity === 'error' ? 'event-warning' : ''}`}>{event.severity === 'warning' || event.severity === 'critical' || event.severity === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}</span><div><p>{event.message}</p><span>{[event.room_name, event.device_name].filter(Boolean).join(' · ') || event.user_name || 'Система дома'}</span></div><time>{dateTime(event.created_at)}</time></div>)}</div>; }
export function Toasts() { const { toasts, dismissToast } = useApp(); return <div className="toast-container" aria-live="polite" aria-atomic="false">{toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>{toast.tone === 'error' ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}<span>{toast.message}</span><button aria-label="Закрыть уведомление" onClick={() => dismissToast(toast.id)}><X size={16} /></button></div>)}</div>; }
export function Chart({ readings, unit = '', height = 150 }: { readings: Reading[]; unit?: string; height?: number }) {
  if (!readings.length) return <Empty title="Пока нет измерений" description="Здесь появится история показаний устройства." />;
  const values = readings.map(item => item.value); const low = Math.min(...values); const high = Math.max(...values); const span = Math.max(high - low, 1); const points = values.map((value, index) => `${25 + index / Math.max(values.length - 1, 1) * 550},${height - 25 - (value - low) / span * (height - 50)}`).join(' ');
  return <div className="chart"><div className="chart-range"><span>{high.toLocaleString('ru-RU')}{unit}</span><span>{low.toLocaleString('ru-RU')}{unit}</span></div><svg role="img" aria-label={`История: ${readings.length} измерений, минимум ${low}${unit}, максимум ${high}${unit}`} viewBox={`0 0 600 ${height}`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bb874b" stopOpacity=".18" /><stop offset="100%" stopColor="#bb874b" stopOpacity="0" /></linearGradient></defs>{[.25, .5, .75].map(fraction => <line key={fraction} x1="25" x2="575" y1={height * fraction} y2={height * fraction} stroke="#ece9e3" strokeDasharray="4 5" />)}<polygon points={`25,${height} ${points} 575,${height}`} fill="url(#chartFill)" /><polyline points={points} fill="none" stroke="#b18048" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg><div className="chart-labels"><span>{dateTime(readings[0].created_at)}</span><span>{dateTime(readings[readings.length - 1].created_at)}</span></div></div>;
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" onClick={onClick}>{children}<ChevronRight size={15} /></button>; }
