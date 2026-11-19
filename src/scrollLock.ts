const locks = new Set<symbol>();
const listeners = new Set<() => void>();
let previousOverflow = '';

export const isScrollLocked = () => locks.size > 0;
export const subscribeScrollLock = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function acquireScrollLock() {
  const token = Symbol();
  if (!locks.size) previousOverflow = document.body.style.overflow;
  locks.add(token);
  document.body.style.overflow = 'hidden';
  listeners.forEach(listener => listener());
  return () => {
    if (!locks.delete(token)) return;
    if (!locks.size) document.body.style.overflow = previousOverflow;
    listeners.forEach(listener => listener());
  };
}
