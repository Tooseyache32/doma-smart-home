import type { User, Snapshot } from '../shared/types';

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.fields = fields;
  }
}
let csrf: string | null = null;
export const setCsrf = (value: string | null) => { csrf = value; };
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && csrf) headers.set('X-CSRF-Token', csrf);
  let response: Response;
  try { response = await fetch(path, { ...options, headers, credentials: 'same-origin' }); }
  catch { throw new ApiError('Не удалось связаться с домом. Проверьте подключение и попробуйте ещё раз.', 0); }
  const json = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(String(json.error || 'Что-то пошло не так. Попробуйте ещё раз.'), response.status, (json.fields || {}) as Record<string, string>);
  return json as T;
}
export const send = <T,>(path: string, method: string, body?: unknown) => api<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export type AuthResponse = { user: User | null; csrf: string | null };
export const getSnapshot = (homeId?: number) => api<Snapshot>(`/api/home${homeId ? `?homeId=${homeId}` : ''}`);
export const dateTime = (value: string) => {
  const date = new Date(value.includes('T') || /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const timeOnly = (value: string) => {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};
export const numberText = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
