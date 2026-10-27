import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useStore } from '../state/store';
import { Icon } from '../icons/Icon';
import { RAIL_ENTRIES, type NavEntry } from '../nav/navMap';
import { runNavAction } from '../nav/actions';
import { useMediaQuery } from './left/useMediaQuery';
import './Rail.css';

/** The width below which the rail is the phone's bottom tab bar (the same number as `Rail.css`). */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The far-left rail of the visual pass: the app's places as icon buttons over their 11 px names –
 * Slicing (the plater), Library, Printers – and, at the bottom, Preferences and About. The current
 * place is filled with the accent colour. The update notice is the top bar's (the About dialog keeps
 * its row).
 *
 * The entries come from the navigation map (`nav/navMap.ts`), the single home of every function, so
 * the rail cannot grow a second door next to the menu. Slicing is current on the plater and in the
 * preview; Preferences is a dialog now and never current. A wide screen shows the names under the
 * icons, a narrow one keeps the icons, and below 640 px the rail turns into a bottom tab bar.
 *
 * The phone's tab bar has the four tabs of the responsive table (Layout-3.0 §4): Slicing, Library,
 * Printers and More. More is a container, not a new function – it opens the remaining rail rows
 * (Preferences, About) one tap away, so nothing leaves the tab bar's four tabs.
 */
export function Rail() {
  const view = useStore((s) => s.view);
  const phone = useMediaQuery(PHONE_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const active = (id: string) => (id === 'slicing' ? view === 'plater' || view === 'preview' : false);
  const top = RAIL_ENTRIES.filter((e) => e.id !== 'preferences' && e.id !== 'about');
  const bottom = RAIL_ENTRIES.filter((e) => e.id === 'preferences' || e.id === 'about');
  const button = (entry: NavEntry) => (
    <button
      key={entry.id}
      className={`rail-item ${active(entry.id) ? 'active' : ''}`}
      title={entry.label}
      aria-current={active(entry.id) ? 'page' : undefined}
      onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
        e.currentTarget.blur();
        setMoreOpen(false);
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

  // a tap outside closes More; it is a menu, not a dialog, so nothing else changes
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moreOpen]);

  return (
    <nav className="rail" data-testid="rail" aria-label="Main">
      <div className="rail-group">{top.map(button)}</div>
      {phone ? (
        <div className="rail-group rail-more" ref={moreRef}>
          <button
            className={`rail-item ${moreOpen ? 'active' : ''}`}
            title="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="rail-more-menu"
            onClick={(e) => {
              e.currentTarget.blur();
              setMoreOpen((open) => !open);
            }}
            data-testid="rail-more"
          >
            <Icon name="more" size={22} />
            <span className="rail-label">More</span>
          </button>
          {moreOpen && (
            <div className="rail-more-menu" role="menu" aria-label="More" id="rail-more-menu" data-testid="rail-more-menu">
              {[preferences, about]
                .filter((e): e is NavEntry => !!e)
                .map((entry) => (
                  <button
                    key={entry.id}
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      void runNavAction(entry.action);
                    }}
                    data-testid={`${entry.testId}-more`}
                  >
                    <Icon name={entry.icon} size={18} />
                    <span>{entry.label}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rail-group rail-bottom">
          {preferences && button(preferences)}
          {about && button(about)}
        </div>
      )}
    </nav>
  );
}
