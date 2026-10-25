import { Rail } from './Rail';
import { TopBar } from './TopBar';
import { ContextPanel } from './context/ContextPanel';
import { LeftColumn } from './left/LeftColumn';
import { SettingsView } from './SettingsView';
import { Viewer } from '../three/Viewer';
import { DropZone } from './DropZone';
import type { CSSProperties } from 'react';
import { useStore } from '../state/store';
import './AppShell.css';

/**
 * The frame of the visual pass: the rail runs the full height on the left, the 48 px top bar starts
 * beside it, and the scene fills everything below the bar. The object list and the context panel float
 * over the scene as cards, so the canvas never takes their width and does not change size when a card
 * folds or the hide-panels toggle hides both.
 *
 * The cards live in the scene's own rectangle (`.scene-area`), so their edges follow the scene at every
 * window size – a phone's bottom bar is simply below them.
 *
 * The settings views stay a page of their own (`SettingsView`) in the area right of the rail; they are
 * not a plater and carry no overlay cards.
 *
 * The object list card's width is the user's (persisted in the `layout` slice, dragged with the card's
 * grip). The frame publishes it as `--list-width`, so the card and the strip's band read the same
 * number; folding the card and the phone layout override it in the stylesheet.
 */
export function AppShell() {
  const view = useStore((s) => s.view);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const leftWidth = useStore((s) => s.leftWidth);
  const settings = view === 'print' || view === 'filament' || view === 'printer';
  const classes = ['app-shell', settings && 'settings-mode', panelsHidden && 'panels-hidden'].filter(Boolean).join(' ');
  return (
    <div className={classes} data-testid="app-shell" style={{ '--list-width': `${leftWidth}px` } as CSSProperties}>
      <TopBar />
      <Rail />
      {settings ? (
        <SettingsView />
      ) : (
        <div className="scene-area">
          <DropZone>
            <Viewer />
          </DropZone>
          <LeftColumn />
          <ContextPanel />
        </div>
      )}
    </div>
  );
}
