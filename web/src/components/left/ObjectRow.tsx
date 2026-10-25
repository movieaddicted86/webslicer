import { useMemo, type KeyboardEvent } from 'react';
import { useStore, type PlaterObject } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { objectIsOutside } from '../../plater/plateCheck';
import { fmt } from '../../format';
import { Icon } from '../../icons/Icon';
import { InlineName } from '../common/InlineName';
import './ObjectRow.css';

/**
 * One plain row of the object list: the visibility checkbox, the name, the badges, the instance
 * count with its sub-list and the info line. Double-clicking a name (or F2 on the selected object)
 * renames it; selecting the row shows the object in the context panel, where its parts, settings,
 * ranges and transform live.
 */
export function ObjectRow({
  o,
  instancesShown,
  onToggleInstances,
  renaming,
  onRename,
  onStopRename,
}: {
  o: PlaterObject;
  instancesShown: boolean;
  onToggleInstances: () => void;
  /** the row is in rename mode (double-click on the name, F2 or the shared rename request) */
  renaming: boolean;
  onRename: () => void;
  onStopRename: () => void;
}) {
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const select = useStore((s) => s.select);
  const selectInstance = useStore((s) => s.selectInstance);
  const removeInstance = useStore((s) => s.removeInstance);
  const instanceToObject = useStore((s) => s.instanceToObject);
  const splitToObjects = useStore((s) => s.splitToObjects);
  const update = useStore((s) => s.updateObject);
  const renameObject = useStore((s) => s.renameObject);
  const recordHistory = useStore((s) => s.recordHistory);
  const isSel = selectedIds.includes(o.id);
  // the row's buttons show a symbol only, so each tooltip is also its accessible name
  const instancesLabel = `${o.instances.length} instances – click to show them`;
  // the info is a full mesh measurement: keep it off the render path of every unrelated store change
  const info = useMemo(() => objectInfo(o), [o]);
  const selectOnKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // the buttons inside the row handle their own keys
    if ((e.target as HTMLElement).closest('input, button')) return;
    e.preventDefault();
    select([o.id]);
  };
  return (
    <li className="object-item">
      <div
        className={`object-row ${isSel && !selectedVolumeId ? 'selected' : ''} ${objectIsOutside(o, bedShape, maxHeight) ? 'outside' : ''}`}
        data-testid="object-row"
        data-object-id={o.id}
        role="button"
        aria-pressed={isSel && !selectedVolumeId}
        tabIndex={0}
        onClick={(e) => select([o.id], e.ctrlKey || e.shiftKey)}
        onKeyDown={selectOnKey}
        onDoubleClick={(e) => {
          // a double-click on the row (not on a button) starts the rename, like PrusaSlicer
          if ((e.target as HTMLElement).closest('input, button')) return;
          e.stopPropagation();
          onRename();
        }}
      >
        <input
          type="checkbox"
          checked={o.visible}
          onChange={(e) => {
            recordHistory();
            update(o.id, { visible: e.target.checked });
          }}
          onClick={(e) => e.stopPropagation()}
          title="Visible / printable"
        />
        <span className="object-thumb" aria-hidden="true">
          <Icon name="objects" size={18} />
        </span>
        <div className="object-text">
          {renaming ? (
            <InlineName
              initial={o.name}
              title="Name (Enter saves, Esc cancels)"
              onSave={(name) => {
                renameObject(o.id, name);
                onStopRename();
              }}
              onCancel={onStopRename}
            />
          ) : (
            <b className="name" title={`${o.name} – double-click to rename`}>
              {o.name}
            </b>
          )}
          <div
            className="object-info"
            data-testid="object-info"
            title="Size, volume, triangles, manifold state and instances of this object"
          >
            {fmt(info.size[0])} × {fmt(info.size[1])} × {fmt(info.size[2])} mm · {fmt(info.volume, 2)} cm³ ·{' '}
            {info.triangles.toLocaleString()} triangles · {info.instances} {info.instances === 1 ? 'instance' : 'instances'}
            {info.openEdges > 0 && (
              <span className="not-manifold" title="The mesh has boundary edges – the slicer will repair or refuse it">
                {' '}
                · Not manifold – {info.openEdges} open edges
              </span>
            )}
          </div>
        </div>
        {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
        {Object.keys(o.config).length > 0 && (
          <span className="badge" title="This object overrides print settings">
            <Icon name="overridden" size={12} />
          </span>
        )}
        {o.instances.length > 1 && (
          <button
            className="badge inst"
            data-testid="object-instances-badge"
            title={instancesLabel}
            aria-label={instancesLabel}
            onClick={(e) => {
              e.stopPropagation();
              onToggleInstances();
            }}
          >
            ×{o.instances.length}
          </button>
        )}
      </div>
      {o.instances.length > 1 && instancesShown && (
        <ul className="instance-list">
          {o.instances.map((inst, i) => (
            <li
              key={inst.id}
              className={`instance-row ${isSel && selectedInstanceId === inst.id ? 'selected' : ''}`}
              role="button"
              aria-pressed={isSel && selectedInstanceId === inst.id}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                selectInstance(o.id, inst.id);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if ((e.target as HTMLElement).closest('button')) return;
                e.preventDefault();
                selectInstance(o.id, inst.id);
              }}
              title={`Instance ${i + 1} of ${o.instances.length}`}
            >
              <span className="iname">Instance {i + 1}</span>
              <span className="muted small">{inst.position.map((v) => fmt(v)).join(' / ')}</span>
              <button
                className="icon"
                title="Set as separate object"
                aria-label="Set as separate object"
                onClick={(e) => {
                  e.stopPropagation();
                  instanceToObject(o.id, inst.id);
                }}
              >
                <Icon name="instanceToObject" size={14} />
              </button>
              <button
                className="icon"
                title="Split to objects"
                aria-label="Split to objects"
                onClick={(e) => {
                  e.stopPropagation();
                  selectInstance(o.id, inst.id);
                  void splitToObjects(o.id);
                }}
              >
                <Icon name="splitToObjects" size={14} />
              </button>
              <button
                className="icon"
                title="Delete instance"
                aria-label="Delete instance"
                disabled={o.instances.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  removeInstance(o.id, inst.id);
                }}
              >
                <Icon name="delete" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
