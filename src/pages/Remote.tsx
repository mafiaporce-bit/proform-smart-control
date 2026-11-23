import { Icon } from '../components/icons';
import { Card, ConnectButtons, PageHeader, SafetyNote, StatusPill, SupportWarning, go } from '../components/ui';
import { useBle } from '../ble/useBle';

// Shown on the buttons only. They are disabled, so none of these is ever sent.
const PRESETS = [3, 5, 6.5, 8, 10];

export function Remote() {
  const s = useBle();
  return (
    <>
      <PageHeader title="Treadmill Remote" sub="ProForm 105 CST" right={<StatusPill />} />

      <SafetyNote />

      <Card className="mt-4 text-center">
        <div className="label">Belt speed from treadmill</div>
        <div className="digits mega mega-off mt-3" aria-label="No speed reading">
          --.-
        </div>
        <div className="mt-1 text-[15px] font-semibold text-mute">km/h</div>
        <p className="mx-auto mt-3 max-w-[300px] text-[12.5px] text-mute">
          No reading shown. The treadmill's data format has not been decoded yet, and this app never shows made-up numbers.
        </p>
      </Card>

      <Card className="hatch mt-4 !border-warn/30">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warn/15 text-warn">
            <Icon name="lock" />
          </span>
          <div>
            <div className="font-semibold">Controls are locked</div>
            <p className="mt-0.5 text-[13px] text-mute">
              These buttons stay locked, by design. The app reads your treadmill's speed and coaches you to match a plan, but it never changes the belt. Speed, start and stop stay
              on the console and the safety key.
            </p>
          </div>
        </div>
      </Card>

      <fieldset disabled aria-label="Speed controls (locked)" className="mt-4 space-y-4">
        <Card>
          <div className="flex items-center justify-between">
            <span className="label">Speed</span>
            <span className="pill"><Icon name="lock" size={12} /> Locked</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn !min-h-[68px] flex-1 !rounded-[20px]" aria-label="Decrease speed by 0.1 km/h">
              <Icon name="minus" size={28} />
            </button>
            <div className="w-20 text-center text-[12px] text-dim">0.1 km/h steps</div>
            <button className="btn !min-h-[68px] flex-1 !rounded-[20px]" aria-label="Increase speed by 0.1 km/h">
              <Icon name="plus" size={28} />
            </button>
          </div>
          <input type="range" className="range mt-3" min={1} max={10} step={0.1} defaultValue={1} aria-label="Speed slider (locked)" />
          <div className="mt-2 grid grid-cols-5 gap-2">
            {PRESETS.map((p) => (
              <button key={p} className="btn btn-sm !px-0">
                <span className="digits">{p}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-dim">Speed limits will be set from the treadmill's verified range, never above its rating.</p>
        </Card>

        <div className="grid grid-cols-2 gap-2.5">
          <button className="btn btn-danger !min-h-[60px]">
            <Icon name="stop" size={18} /> Normal Stop
          </button>
          <button className="btn !min-h-[60px]">
            <Icon name="pause" size={18} /> Pause
          </button>
        </div>
      </fieldset>

      <Card className="mt-4">
        <dl className="divide-y divide-line text-[13.5px]">
          {[
            ['Normal Stop', 'Locked. A software request, never an emergency stop'],
            ['Pause', 'Not known to be supported on this model'],
            ['Remote Start', 'Unavailable. Needs separate proof and a safety review'],
            ['Incline', 'Manual. Set it by hand on the deck'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-3 py-2.5">
              <dt className="w-[108px] shrink-0 font-semibold">{k}</dt>
              <dd className="text-mute">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <div className="label">Bluetooth link</div>
          <StatusPill />
        </div>
        <p className="mt-2 text-[13px] text-mute">
          {s.status === 'connected' ? `Connected to "${s.deviceName}" in listen-only mode.` : 'Connect to listen to the treadmill. Connecting does not unlock the controls.'}
        </p>
        <div className="mt-3 space-y-3">
          <SupportWarning />
          <ConnectButtons />
          <button className="btn btn-sm w-full" onClick={() => go('diagnostics')}>
            <Icon name="flask" size={18} /> Open Bluetooth Lab
          </button>
        </div>
      </Card>
    </>
  );
}
