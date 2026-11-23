import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></>,
  remote: <><rect x="7" y="2.5" width="10" height="19" rx="4" /><circle cx="12" cy="8" r="1.6" /><path d="M12 13v4M10 15h4" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  bluetooth: <path d="m7 7 10 10-5 4V3l5 4L7 17" />,
  spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m12 8 1.4 2.6L16 12l-2.6 1.4L12 16l-1.4-2.6L8 12l2.6-1.4z" /></>,
  list: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></>,
  wave: <path d="M2 12h3l2-6 4 13 3-10 2 5 1.5-2H22" />,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  key: <><circle cx="8" cy="14" r="4" /><path d="m11 11 9-9M16 6l3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  back: <path d="m14 5-7 7 7 7" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  download: <><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /></>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  flame: <path d="M12 21c-3.6 0-6-2.5-6-5.8 0-3 2.2-4.4 3-7.2.8 1.2 1.3 2.5 1.2 3.800C12 10 13 7 12.5 3c3.5 2.5 5.5 6.5 5.5 10.5 0 4-2.4 7.5-6 7.500z" />,
  route: <><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="6" r="2.2" /><path d="M8.2 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.500V12l3 2" /></>,
  alert: <><path d="M12 3.5 2.8 19.500h18.400z" /><path d="M12 10v4.500M12 17.200v.300" /></>,
  volume: <><path d="M4 9.500v5h3.500L12 18V6L7.5 9.500z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.500a7.5 7.5 0 0 1 0 11" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.800v.300" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  flask: <><path d="M9.5 3h5M10.5 3v6L5 19a1.5 1.5 0 0 0 1.3 2.200h11.400A1.5 1.5 0 0 0 19 19l-5.5-10V3" /><path d="M8 15h8" /></>,
  mute: <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="m10 21 2.5-7 2.5 3v4M9 11l2.5-3.5L15 9l2 3M12.5 7.5 11 14" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="3" /><path d="M11 18.500h2" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, className = '' }: { name: string; size?: number; className?: string }) {
  const filled = name === 'play' || name === 'stop';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12204d" />
          <stop offset="1" stopColor="#060b1f" />
        </linearGradient>
        <linearGradient id="lg-st" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b82ff" />
          <stop offset=".6" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#8f7bff" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#lg-bg)" stroke="rgba(140,160,255,.25)" strokeWidth="6" />
      <path d="M112 356h288" stroke="#1c2a55" strokeWidth="30" strokeLinecap="round" />
      <path d="M112 356h168" stroke="url(#lg-st)" strokeWidth="30" strokeLinecap="round" />
      <path d="M120 250h70l34-84 52 150 36-96 22 30h58" fill="none" stroke="url(#lg-st)" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
