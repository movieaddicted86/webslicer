import type { MouseEvent } from 'react';
import { useStore } from '../state/store';
import { Icon } from '../icons/Icon';
import { RAIL_ENTRIES } from '../nav/navMap';
import { runNavAction } from '../nav/actions';
import { UpdateChip } from './UpdateChip';
import './Rail.css';

/**
 * The far-left rail of the 3.0 layout: the app's places as icon buttons over their names – Slicing
 * (the plater), Library, Printers – and, at the bottom, Preferences and About with the update notice.
 *
 * The entries come from the navigation map (`nav/navMap.ts`), the single home of every function, so
 * the rail cannot grow a second door next to the menu. Slicing is current on the plater and in the
 * preview; Preferences is a dialog now and never current. A wide screen shows the names under the
 * icons, a narrow one keeps the icons, and below 640 px the rail turns into a bottom tab bar.
 */
export function Rail() {
  const view = useStore((s) => s.view);

  const active = (id: string) => (id === 'slicing' ? view === 'plater' || view === 'preview' : false);
  const top = RAIL_ENTRIES.filter((e) => e.id !== 'preferences' && e.id !== 'about');
  const bottom = RAIL_ENTRIES.filter((e) => e.id === 'preferences' || e.id === 'about');
  const button = (entry: (typeof RAIL_ENTRIES)[number]) => (
    <button
      key={entry.id}
      className={`rail-item ${active(entry.id) ? 'active' : ''}`}
      title={entry.label}
      aria-current={active(entry.id) ? 'page' : undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.blur();
        void runNavAction(entry.action);
      }}
      data-testid={entry.testId}
      data-nav-id={entry.id}
    >
      <Icon name={entry.icon} size={22} />
      <span className="rail-label">{entry.label}</span>
    </button>
  );
  const preferences = bottom.find((e) => e.id === 'preferences');
  const about = bottom.find((e) => e.id === 'about');

  return (
    <nav className="rail" data-testid="rail" aria-label="Main">
      <div className="rail-group">{top.map(button)}</div>
      <div className="rail-group rail-bottom">
        {preferences && button(preferences)}
        {about && (
          <div className="rail-about">
            {button(about)}
            {/* the update notice lives on the rail's About item; it renders nothing while current */}
            <UpdateChip compact />
          </div>
        )}
      </div>
    </nav>
  );
}
