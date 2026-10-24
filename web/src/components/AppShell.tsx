import type { CSSProperties } from 'react';
import { useStore } from '../state/store';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { ContextPanel } from './context/ContextPanel';
import { LeftColumn } from './left/LeftColumn';
import { useLeftColumn } from './left/useLeftColumn';
import { SettingsView } from './SettingsView';
import { Viewer } from '../three/Viewer';
import { DropZone } from './DropZone';
import './AppShell.css';

/**
 * The frame of the 3.0 layout: a CSS grid with the rail on the far left, the object list column, the
 * scene and the context panel on the right; the slim top bar sits above all of them.
 *
 * The settings views (Print/Filament/Printer) take the whole area right of the rail, as they did
 * before – they are a page, not a plater.
 *
 * The hide-panels toggle collapses the left column and the context panel to zero width. Both stay
 * mounted and are hidden with `display: none`, so their scroll position and panel state survive a
 * toggle. The scene grows because its grid track does; the viewer's `ResizeObserver` follows the
 * container, so the canvas is never left at the old size.
 *
 * The left track follows the column's own state: the persisted width while it is open, the strip's
 * width while it is folded, and no track on a phone, where the column is a drawer over the scene.
 */
export function AppShell() {
  const view = useStore((s) => s.view);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const { track } = useLeftColumn();
  const settings = view === 'print' || view === 'filament' || view === 'printer';
  const classes = ['app-shell', settings && 'settings-mode', panelsHidden && 'panels-hidden'].filter(Boolean).join(' ');
  return (
    <div className={classes} data-testid="app-shell" style={{ '--left-track': `${track}px` } as CSSProperties}>
      <TopBar />
      <Rail />
      {settings ? (
        <SettingsView />
      ) : (
        <>
          <LeftColumn />
          <DropZone>
            <Viewer />
          </DropZone>
        </>
      )}
      {!settings && <ContextPanel />}
    </div>
  );
}
