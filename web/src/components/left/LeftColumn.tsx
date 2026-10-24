import { useStore } from '../../state/store';
import { SideCard } from './SideCard';
import { useLeftColumn } from './useLeftColumn';
import { ObjectsSection } from './ObjectsSection';
import { SimpleObjects } from './SimpleObjects';
import { SlicedInfo } from '../preview/SlicedInfo';
import { PreviewLegend } from '../preview/Legend';
import { useLegendData } from '../preview/useLegendData';
import { Icon } from '../../icons/Icon';
import './LeftColumn.css';

/**
 * The left column of the 3.0 layout (L-2): the plater's object card and, in the Preview, the cards of
 * the slicing result. It is the column between the rail and the scene; the frame gives it its width.
 *
 * Every card folds on its own (remembered in the `layout` slice) and the column as a whole folds to a
 * strip that keeps the object count; the button in the column's top corner does that. Below
 * `LEFT_COLUMN_OPEN_MIN_WINDOW` the column starts folded, and on a phone it is a drawer over the
 * scene that the top bar opens (the proper mobile treatment comes with the mobile track).
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
        <button
          className="left-column-toggle"
          data-testid="left-column-toggle"
          aria-expanded={!folded}
          aria-label={folded ? 'Unfold the object list' : 'Fold the object list'}
          title={folded ? 'Unfold the object list' : 'Fold the object list'}
          onClick={toggle}
        >
          <Icon name="expand" size={16} />
          {folded && <span className="left-count">{objects.length}</span>}
        </button>
        {phone && <span className="left-drawer-title">Objects</span>}
        {phone && (
          <button className="left-drawer-close" aria-label="Close the object list" title="Close" onClick={closeDrawer}>
            <Icon name="close" size={16} />
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
              {!job && <div className="muted small">No slicing result yet.</div>}
            </>
          ) : (
            <SideCard
              title="Object list"
              count={objects.length}
              open={open('objects')}
              onToggle={() => toggleCard('objects')}
              toggleLabel={open('objects') ? 'Fold the object list' : 'Unfold the object list'}
              testId="left-objects-card"
              toggleTestId="left-objects-toggle"
            >
              {mode === 'simple' ? <SimpleObjects /> : <ObjectsSection />}
            </SideCard>
          )}
        </div>
      )}
      {!folded && !phone && <ResizeHandle />}
    </aside>
  );
}

/** The width grip on the column's right edge: drag it, or focus it and use the arrow keys. */
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
