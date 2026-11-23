import type { ReactNode } from 'react';
import { Icon } from './icons';
import { ble } from '../ble/manager';
import { useBle } from '../ble/useBle';
import type { BleState } from '../ble/manager';

export const CREDIT = 'Copyright © 2026 Zenix_dev@company. All rights reserved. Developed by JPSums';

export const go = (route: string) => {
  window.location.hash = route === 'home' ? '' : `/${route}`;
};

export function statusView(s: BleState): { text: string; dot: string; tone: string } {
  if (s.support !== 'ok') return { text: 'Bluetooth unavailable', dot: 'dot-bad', tone: 'text-bad' };
  switch (s.status) {
    case 'connected': return { text: 'Connected', dot: 'dot-live', tone: 'text-good' };
    case 'choosing': return { text: 'Choose device…', dot: 'dot-busy', tone: 'text-warn' };
    case 'connecting': return { text: s.reconnectAttempt ? `Reconnecting ${s.reconnectAttempt}/5…` : 'Connecting…', dot: 'dot-busy', tone: 'text-warn' };
    case 'discovering': return { text: 'Discovering…', dot: 'dot-busy', tone: 'text-warn' };
    case 'disconnected': return { text: 'Disconnected', dot: 'dot-bad', tone: 'text-bad' };
    case 'error': return { text: 'Connection failed', dot: 'dot-bad', tone: 'text-bad' };
    default: return { text: 'Not connected', dot: '', tone: 'text-mute' };
  }
}

export function StatusPill() {
  const s = useBle();
  const v = statusView(s);
  return (
    <span className={`pill ${v.tone}`} role="status" aria-live="polite">
      <span className={`dot ${v.dot}`} />
      {v.text}
    </span>
  );
}

export function PageHeader({ title, sub, back, right }: { title: string; sub?: string; back?: string; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 pt-1 pb-4">
      {back && (
        <button className="btn btn-sm !px-0 w-11 shrink-0" onClick={() => go(back)} aria-label="Back">
          <Icon name="back" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-bold tracking-tight leading-tight">{title}</h1>
        {sub && <p className="text-[13px] text-mute truncate">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Card({ children, className = '', hot = false }: { children: ReactNode; className?: string; hot?: boolean }) {
  return <section className={`glass ${hot ? 'glass-hot' : ''} p-4 ${className}`}>{children}</section>;
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-[12.5px] text-mute">{hint}</div>}
      </div>
      <button role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)} />
    </div>
  );
}

/** Shown wherever treadmill control appears. */
export function SafetyNote({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-warn/30 bg-warn/[0.07] p-3.5 text-[13px] leading-snug text-[#ffe9b0]">
      <Icon name="key" className="shrink-0 text-warn" />
      <p>
        <strong className="font-semibold">Clip on the safety key.</strong>{' '}
        {compact
          ? 'To stop at once, pull the key. This app is not an emergency stop.'
          : 'To stop at once, pull the key or press Stop on the console. Nothing in this app is an emergency stop, and a phone can lose its Bluetooth link at any moment.'}
      </p>
    </div>
  );
}

const supportText: Record<string, { title: string; body: string }> = {
  'no-api': {
    title: 'This browser has no Web Bluetooth',
    body: 'Open the app in Chrome on your Samsung phone (or Chrome or Edge on a laptop). Firefox, Samsung Internet and every iPhone browser cannot talk to Bluetooth devices from a web page.',
  },
  insecure: {
    title: 'Bluetooth needs a secure address',
    body: 'Web Bluetooth only works on https:// pages. Open the app from its Netlify https link.',
  },
  'adapter-off': {
    title: 'Bluetooth is switched off',
    body: 'Turn on Bluetooth on this device, then try again. On Android also allow Chrome the "Nearby devices" permission (or Location on Android 11 and older).',
  },
};

export function SupportWarning() {
  const s = useBle();
  if (s.support === 'ok') return null;
  const t = supportText[s.support];
  return (
    <div className="flex gap-3 rounded-2xl border border-bad/30 bg-bad/[0.08] p-3.5 text-[13px] leading-snug">
      <Icon name="alert" className="shrink-0 text-bad" />
      <div>
        <div className="font-semibold text-[#ffd0d8]">{t.title}</div>
        <p className="text-mute mt-0.5">{t.body}</p>
      </div>
    </div>
  );
}

/** Connect / disconnect buttons driven by the real connection state. */
export function ConnectButtons({ small = false }: { small?: boolean }) {
  const s = useBle();
  const busy = ['choosing', 'connecting', 'discovering'].includes(s.status);
  const size = small ? 'btn-sm' : '';
  if (s.status === 'connected' || busy) {
    return (
      <button className={`btn ${size} w-full`} onClick={() => ble.disconnect()}>
        <Icon name="bluetooth" size={18} />
        {busy ? 'Cancel' : 'Disconnect'}
      </button>
    );
  }
  const known = s.deviceName !== null && (s.status === 'disconnected' || s.status === 'error');
  return (
    <div className="flex gap-2">
      {known && (
        <button className={`btn btn-primary ${size} flex-1`} disabled={s.support !== 'ok'} onClick={() => void ble.reconnect()}>
          <Icon name="refresh" size={18} />
          Reconnect
        </button>
      )}
      <button
        className={`btn ${known ? '' : 'btn-primary'} ${size} flex-1`}
        disabled={s.support !== 'ok'}
        onClick={() => void ble.connect()}
      >
        <Icon name="bluetooth" size={18} />
        {known ? 'Pick device' : 'Connect treadmill'}
      </button>
    </div>
  );
}

export function Footer() {
  return <p className="px-2 pt-6 pb-2 text-center text-[11px] leading-relaxed text-dim">{CREDIT}</p>;
}

export function Stat({ icon, label, value, unit, tone = 'text-cyan' }: { icon: string; label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className="glass p-3.5">
      <div className="flex items-center gap-1.5 label">
        <Icon name={icon} size={14} className={tone} />
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="digits text-[26px] font-semibold leading-none">{value}</span>
        {unit && <span className="text-[12px] text-mute">{unit}</span>}
      </div>
    </div>
  );
}
