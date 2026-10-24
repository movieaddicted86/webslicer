import { useStore } from '../state/store';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { Sidebar } from './Sidebar';
import { SettingsView } from './SettingsView';
import { Viewer } from '../three/Viewer';
import { DropZone } from './DropZone';
import './AppShell.css';

/**
 * The frame of the 3.0 layout (L-1): a CSS grid with the rail on the far left, an empty left column
 * (the object list arrives in L-2), the scene and the existing sidebar on the right; the slim top bar
 * sits above all of them.
 *
 * The settings views (Print/Filament/Printer) take the whole area right of the rail, as they did
 * before – they are a page, not a plater. The plater keeps its scene and its sidebar exactly where
 * they were: this step only builds the frame, later steps move content into the new regions.
 *
 * The hide-panels toggle collapses the left column and the sidebar to zero width. The sidebar stays
 * mounted and is hidden with `display: none`, so its scroll position and the panel state survive a
 * toggle. The scene grows because its grid track does; the viewer's `ResizeObserver` follows the
 * container, so the canvas is never left at the old size.
 */
export function AppShell() {
  const view = useStore((s) => s.view);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const settings = view === 'print' || view === 'filament' || view === 'printer';
  return (
    <div className={`app-shell ${settings ? 'settings-mode' : ''} ${panelsHidden ? 'panels-hidden' : ''}`} data-testid="app-shell">
      <TopBar />
      <Rail />
      {settings ? (
        <SettingsView />
      ) : (
        <DropZone>
          <Viewer />
        </DropZone>
      )}
      {!settings && <Sidebar />}
    </div>
  );
}
