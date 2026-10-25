import { useStore } from '../../state/store';
import { SideCard } from './SideCard';
import { useLeftColumn } from './useLeftColumn';
import { ObjectsSection } from './ObjectsSection';
import { SimpleObjects } from './SimpleObjects';
import { SlicedInfo, SlicedBadge } from '../preview/SlicedInfo';
import { PreviewLegend } from '../preview/Legend';
import { SchemeSelect } from '../preview/SchemeSelect';
import { useLegendData } from '../preview/useLegendData';
import { Icon } from '../../icons/Icon';
import './LeftColumn.css';

/**
 * The object list card of the visual pass: a floating card at the top left of the scene, over the 3D
 * view (`LeftColumn.css`). It is not a column of the frame, so the canvas does not take its width and
 * does not resize when the card folds.
 *
 * The card's own header carries the title and the object count and folds the whole card to that row;
 * a folded card keeps the count, so the list is one click away again. The body is the object list (or,
 * in Simple mode, its reduced section) in the plater and the two result cards – sliced info and legend –
 * in the preview, each of which folds on its own (remembered in the `layout` slice).
 *
 * Below `LEFT_COLUMN_OPEN_MIN_WINDOW` the card starts folded, and below 900 px it is a drawer that the
 * top bar opens over the scene.
 */
export function LeftColumn() {
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const objects = useStore((s) => s.objects);
  const job = useStore((s) => s.job);
  const cards = useStore((s) => s.leftCards);
  const toggleCard = useStore((s) => s.toggleLeftCard);
  const { phone, folded, hidden, toggle, closeDrawer } = useLeftColumn();
  const legend = useLegendData();
  const open = (key: string) => !cards[key];
  const preview = view === 'preview';

  return (
    <aside
      className={`left-column ${preview ? 'preview' : ''} ${folded ? 'folded' : ''} ${phone ? 'drawer' : ''}`}
      data-testid="left-column"
      aria-label={preview ? 'Preview information' : 'Objects'}
      hidden={hidden}
    >
      <div className="left-column-head">
        <h3 className="left-column-title">{preview ? 'Preview' : 'Object list'}</h3>
        {!preview && objects.length > 0 && <span className="left-count">{objects.length}</span>}
        <span className="left-column-grow" />
        {phone ? (
          <button className="left-drawer-close" aria-label="Close the object list" title="Close" onClick={closeDrawer}>
            <Icon name="close" size={16} />
          </button>
        ) : (
          <button
            className="left-column-toggle"
            data-testid="left-column-toggle"
            aria-expanded={!folded}
            aria-label={folded ? 'Unfold the object list' : 'Fold the object list'}
            title={folded ? 'Unfold the object list' : 'Fold the object list'}
            onClick={toggle}
          >
            <Icon name="expand" size={16} />
          </button>
        )}
      </div>
      {!folded && (
        <div className="left-cards">
          {preview ? (
            <>
              {job && (
                <SideCard
                  title="Sliced info"
                  aside={<SlicedBadge />}
                  open={open('slicedInfo')}
                  onToggle={() => toggleCard('slicedInfo')}
                  toggleLabel={open('slicedInfo') ? 'Fold the sliced info' : 'Unfold the sliced info'}
                  testId="sliced-info"
                  toggleTestId="left-sliced-toggle"
                >
                  <SlicedInfo />
                </SideCard>
              )}
              {legend.gcode && (
                <SideCard
                  title="Legend"
                  aside={<SchemeSelect className="scheme-head" testId="legend-scheme" />}
                  open={open('legend')}
                  onToggle={() => toggleCard('legend')}
                  toggleLabel={open('legend') ? 'Fold the legend' : 'Unfold the legend'}
                  testId="left-legend-card"
                  toggleTestId="left-legend-toggle"
                >
                  <PreviewLegend
                    gcode={legend.gcode}
                    usedTools={legend.usedTools}
                    featureTimeScale={legend.featureTimeScale}
                    featureShare={legend.featureShare}
                    estimatedSeconds={legend.estimatedSeconds}
                  />
                </SideCard>
              )}
              {!job && <div className="left-empty muted small">No slicing result yet.</div>}
            </>
          ) : mode === 'simple' ? (
            <SimpleObjects />
          ) : (
            <ObjectsSection />
          )}
        </div>
      )}
      {!folded && !phone && <ResizeHandle />}
    </aside>
  );
}

/** The width grip on the card's right edge: drag it, or focus it and use the arrow keys. */
function ResizeHandle() {
  const width = useStore((s) => s.leftWidth);
  const setWidth = useStore((s) => s.setLeftWidth);
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startWidth = width;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(startWidth + ev.clientX - startX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  return (
    <div
      className="left-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the object list"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={drag}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setWidth(width - 20);
        else if (e.key === 'ArrowRight') setWidth(width + 20);
        else return;
        e.preventDefault();
      }}
    />
  );
}
