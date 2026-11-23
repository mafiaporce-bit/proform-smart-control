// Messages between the Park Discovery 3K scene and the host app (ProForm Smart
// Control). Same-origin only. The scene never opens Bluetooth and never sends
// anything to the treadmill: it only draws what the host tells it.
//
// Host -> scene  { type: 'VR_CMD', pace, playing, meters, view, quality }
// Scene -> host  { source: 'proform-park', type: 'VR_READY' | 'VR_STATE' | 'VR_ERROR', ... }

export function initBridge(hooks) {
  const embedded = window.parent !== window;
  const post = (msg) => {
    if (!embedded) return;
    try { window.parent.postMessage({ source: 'proform-park', ...msg }, location.origin); } catch { /* host gone */ }
  };
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data;
    if (!d || d.type !== 'VR_CMD') return;
    try { hooks.onCommand(d); } catch (err) { post({ type: 'VR_ERROR', message: String((err && err.message) || err) }); }
  });
  window.addEventListener('error', (e) => post({ type: 'VR_ERROR', message: String(e.message || 'Script error') }));
  const tick = () => {
    try { post({ type: 'VR_STATE', ...hooks.getStatus() }); } catch (err) { post({ type: 'VR_ERROR', message: String((err && err.message) || err) }); }
  };
  setInterval(tick, 250);
  return { embedded, post, ready: (info) => post({ type: 'VR_READY', ...info }) };
}
