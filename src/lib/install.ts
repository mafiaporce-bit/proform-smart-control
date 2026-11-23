// Captures Chrome's "install app" prompt so Settings can offer an Install button.
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  emit();
});

export const useCanInstall = () =>
  useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => deferred !== null,
  );

export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  emit();
}

export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches;
