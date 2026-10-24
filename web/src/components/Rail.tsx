import { useStore } from '../state/store';
import { Icon } from '../icons/Icon';
import { UpdateChip } from './UpdateChip';
import './Rail.css';

/**
 * The far-left rail of the 3.0 layout (L-1): the app's places as icon buttons over their names –
 * Slicing (the plater), Library and Printers – and, at the bottom, Preferences and About with the
 * update notice.
 *
 * Slicing is current while a plater view is shown, Preferences while one of the settings views is.
 * Library and Printers still open their dialogs, they become views later. Preferences opens the
 * existing settings entry point (the Print Settings view, from which the view tabs reach Filament and
 * Printer); the proper preferences surface is a later design step. A wide screen shows the names under
 * the icons, a narrow one keeps the icons, and below 640 px the rail turns into a bottom tab bar (plain
 * styling; the mobile track re-skins it).
 */
export function Rail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openDialog = useStore((s) => s.openDialog);

  const slicing = view === 'plater' || view === 'preview';
  const preferences = view === 'print' || view === 'filament' || view === 'printer';
  return (
    <nav className="rail" data-testid="rail" aria-label="Main">
      <div className="rail-group">
        <button
          className={`rail-item ${slicing ? 'active' : ''}`}
          title="Slicing"
          aria-current={slicing ? 'page' : undefined}
          onClick={() => setView('plater')}
          data-testid="rail-slicing"
        >
          <Icon name="slicing" size={22} />
          <span className="rail-label">Slicing</span>
        </button>
        <button className="rail-item" title="Library" onClick={() => openDialog('library', 'open')} data-testid="rail-library">
          <Icon name="library" size={22} />
          <span className="rail-label">Library</span>
        </button>
        <button className="rail-item" title="Printers" onClick={() => openDialog('physicalPrinters')} data-testid="rail-printers">
          <Icon name="printers" size={22} />
          <span className="rail-label">Printers</span>
        </button>
      </div>
      <div className="rail-group rail-bottom">
        <button
          className={`rail-item ${preferences ? 'active' : ''}`}
          title="Preferences – print, filament and printer settings"
          aria-current={preferences ? 'page' : undefined}
          onClick={() => setView('print')}
          data-testid="rail-preferences"
        >
          <Icon name="settings" size={22} />
          <span className="rail-label">Preferences</span>
        </button>
        <div className="rail-about">
          <button className="rail-item" title="About" onClick={() => openDialog('about')} data-testid="rail-about">
            <Icon name="about" size={22} />
            <span className="rail-label">About</span>
          </button>
          {/* T-058: the update notice lives on the rail now; it renders nothing while the install is current */}
          <UpdateChip compact />
        </div>
      </div>
    </nav>
  );
}
