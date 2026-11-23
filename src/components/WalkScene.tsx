// Canvas player for a Virtual Running environment. Plays the photo loop at a
// rate tied to the pace it is given. Ported from the Virtual Trails park
// simulator: same frame timing and gentle sway, restyled, with a cheap blur
// for the wide (landscape / fullscreen) layout so it stays smooth on phones.

import { useEffect, useRef, useState } from 'react';
import type { VirtualEnvironment } from '../lib/environments';

interface Props {
  env: VirtualEnvironment;
  speedKmh: number;
  moving: boolean;
  className?: string;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** Tiny copy of a frame. Scaled back up, it gives a soft blur without a costly blur filter. */
function tinyCopy(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = 36;
  c.height = Math.max(1, Math.round((36 * img.height) / img.width));
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function WalkScene({ env, speedKmh, moving, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speedRef = useRef(speedKmh);
  const movingRef = useRef(moving);
  const dirty = useRef(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  speedRef.current = speedKmh;
  if (movingRef.current !== moving) {
    movingRef.current = moving;
    dirty.current = true;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) { setFailed(true); return; }

    let frames: HTMLImageElement[] = [];
    let blurs: HTMLCanvasElement[] = [];
    let raf = 0;
    let last = 0;
    let phase = 0;
    let shown = -1;
    let alive = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
      const w = Math.max(1, Math.floor(r.width * dpr));
      const h = Math.max(1, Math.floor(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        dirty.current = true;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const cover = (img: CanvasImageSource, iw: number, ih: number, w: number, h: number, scale: number, dx: number) => {
      const f = Math.max(w / iw, h / ih) * scale;
      ctx.drawImage(img, (w - iw * f) / 2 + dx, (h - ih * f) / 2, iw * f, ih * f);
    };

    const draw = (idx: number) => {
      const img = frames[idx];
      if (!img) return;
      const w = canvas.width;
      const h = canvas.height;
      const sway = movingRef.current && !reduceMotion ? Math.sin(phase * Math.PI * 2) * Math.min(3, w * 0.004) : 0;
      if (w / h > 1.3) {
        // Wide: soft blurred fill at the sides, the full sharp frame in the middle.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'low';
        cover(blurs[idx], blurs[idx].width, blurs[idx].height, w, h, 1.15, 0);
        ctx.fillStyle = 'rgba(4, 7, 20, 0.45)';
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = 'high';
        const f = (h / img.height) * 1.015;
        const fw = img.width * f;
        ctx.drawImage(img, (w - fw) / 2 + sway, (h - img.height * f) / 2, fw, img.height * f);
        const side = Math.max(0, (w - fw) / 2);
        if (side > 0) {
          const l = ctx.createLinearGradient(side - 10, 0, side + 60, 0);
          l.addColorStop(0, 'rgba(4,7,20,0.55)');
          l.addColorStop(1, 'rgba(4,7,20,0)');
          ctx.fillStyle = l;
          ctx.fillRect(side - 10, 0, 70, h);
          const r = ctx.createLinearGradient(w - side - 60, 0, w - side + 10, 0);
          r.addColorStop(0, 'rgba(4,7,20,0)');
          r.addColorStop(1, 'rgba(4,7,20,0.55)');
          ctx.fillStyle = r;
          ctx.fillRect(w - side - 60, 0, 70, h);
        }
      } else {
        ctx.imageSmoothingQuality = 'high';
        cover(img, img.width, img.height, w, h, 1.02, sway);
      }
    };

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (!frames.length || document.visibilityState !== 'visible') { last = 0; return; }
      const dt = last ? Math.min((ts - last) / 1000, 0.12) : 0;
      last = ts;
      if (movingRef.current) phase += dt * (speedRef.current / env.refKmh);
      const idx = Math.floor(phase * env.fpsAtRef) % frames.length;
      // Redraw only when something on screen changes. Saves battery while paused.
      if (idx !== shown || dirty.current || (movingRef.current && !reduceMotion)) {
        draw(idx);
        shown = idx;
        dirty.current = false;
      }
    };

    void Promise.all(env.frames.map(loadImage)).then((imgs) => {
      if (!alive) return;
      frames = imgs.filter((x): x is HTMLImageElement => x !== null);
      if (!frames.length) { setFailed(true); return; }
      blurs = frames.map(tinyCopy);
      setReady(true);
      dirty.current = true;
      raf = requestAnimationFrame(loop);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [env]);

  return (
    <div className={`relative overflow-hidden bg-deep ${className}`}>
      {!ready && (
        <img src={env.poster} alt="" className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}
        role="img"
        aria-label={`${env.name}: a person walking along a park trail`}
      />
      {failed && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-ink/80 p-3 text-center text-[13px] text-mute">
          The park images could not load. Check your connection and reopen this page.
        </div>
      )}
    </div>
  );
}
