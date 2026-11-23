import { useEffect, useState } from 'react';
import { Icon } from './components/icons';
import { go } from './components/ui';
import { ble } from './ble/manager';
import { useWorkout } from './lib/workout';
import { Home } from './pages/Home';
import { Remote } from './pages/Remote';
import { WorkoutPage } from './pages/Workout';
import { History } from './pages/History';
import { More } from './pages/More';
import { Programs } from './pages/Programs';
import { Coach } from './pages/Coach';
import { Diagnostics } from './pages/Diagnostics';
import { SettingsPage } from './pages/Settings';

const routes: Record<string, () => React.JSX.Element | null> = {
  home: Home,
  remote: Remote,
  workout: WorkoutPage,
  history: History,
  more: More,
  programs: Programs,
  coach: Coach,
  diagnostics: Diagnostics,
  settings: SettingsPage,
  // Old bookmark to the removed 3D park opens the workout dashboard instead.
  virtual: WorkoutPage,
};

const tabs = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'remote', label: 'Remote', icon: 'remote' },
  { route: 'workout', label: 'Workout', icon: 'play' },
  { route: 'history', label: 'History', icon: 'chart' },
  { route: 'more', label: 'More', icon: 'more' },
];
const tabOf: Record<string, string> = { programs: 'more', coach: 'more', diagnostics: 'more', settings: 'more', virtual: 'workout' };

const readRoute = () => {
  const r = window.location.hash.replace(/^#\/?/, '');
  return routes[r] ? r : 'home';
};

export function App() {
  const [route, setRoute] = useState(readRoute);
  const workout = useWorkout();

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    void ble.refreshSupport();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const Page = routes[route];
  const active = tabOf[route] ?? route;

  return (
    <div className={`mx-auto min-h-dvh w-full max-w-[480px] ${route === 'workout' ? 'landscape:max-w-[1100px]' : ''}`}>
      <main
        key={route}
        className="page px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}
      >
        <Page />
      </main>

      <nav
        className="navbar fixed inset-x-0 bottom-0 z-20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Main"
      >
        <div className="mx-auto flex max-w-[480px] items-stretch px-2">
          {tabs.map((t) => {
            const on = active === t.route;
            const center = t.route === 'workout';
            return (
              <button
                key={t.route}
                onClick={() => go(t.route)}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${on ? 'text-cyan' : 'text-dim'}`}
              >
                {center ? (
                  <span
                    className={`-mt-6 grid h-[52px] w-[52px] place-items-center rounded-full text-[#03101f] shadow-[0_10px_26px_-8px_rgba(34,211,238,.8)] ${
                      workout.status === 'running' ? 'bg-good' : 'bg-gradient-to-br from-blue to-cyan'
                    }`}
                  >
                    <Icon name={workout.status === 'running' ? 'wave' : 'play'} size={22} />
                  </span>
                ) : (
                  <Icon name={t.icon} size={22} />
                )}
                <span>{t.label}</span>
                {on && !center && <span className="absolute top-0 h-[3px] w-8 rounded-full bg-cyan" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
