import { useStore, VOLUME_LABELS, type PlaterObject } from '../../state/store';
import { objectIsOutside } from '../../plater/plateCheck';
import { fmt } from '../../format';
import { ACTION_ICONS } from '../common/icons';
import { VOLUME_ICONS } from './volumes';
import { AddVolumeMenu } from './AddVolumeMenu';

/**
 * One row of the object list with everything that hangs off it: the visibility checkbox, the
 * badges, the add menu and the instance / volume sub-lists.
 */
export function ObjectRow({
  o,
  menuOpen,
  onMenu,
  instancesShown,
  onToggleInstances,
}: {
  o: PlaterObject;
  menuOpen: boolean;
  /** opens / closes the add-volume menu of this row */
  onMenu: (open: boolean) => void;
  instancesShown: boolean;
  onToggleInstances: () => void;
}) {
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedVolumeId = useStore((s) => s.selectedVolumeId);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '');
  const maxHeight = useStore((s) => Number(s.presets.printer.current.max_print_height || 200));
  const select = useStore((s) => s.select);
  const selectVolume = useStore((s) => s.selectVolume);
  const selectInstance = useStore((s) => s.selectInstance);
  const removeInstance = useStore((s) => s.removeInstance);
  const instanceToObject = useStore((s) => s.instanceToObject);
  const splitToObjects = useStore((s) => s.splitToObjects);
  const splitToParts = useStore((s) => s.splitToParts);
  const update = useStore((s) => s.updateObject);
  const recordHistory = useStore((s) => s.recordHistory);
  const isSel = selectedIds.includes(o.id);
  // the row's buttons show a symbol only, so each tooltip is also its accessible name
  const instancesLabel = `${o.instances.length} instances – click to show them`;
  const splitLabel = o.volumes.length ? 'Remove modifiers and parts first' : 'Split to objects';
  return (
    <li className="object-item">
      <div
        className={`object-row ${isSel && !selectedVolumeId ? 'selected' : ''} ${objectIsOutside(o, bedShape, maxHeight) ? 'outside' : ''}`}
        onClick={(e) => select([o.id], e.ctrlKey || e.shiftKey)}
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
        <span className="name" title={o.name}>
          {o.name}
        </span>
        {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
        {Object.keys(o.config).length > 0 && <span className="badge">⚙</span>}
        {o.instances.length > 1 && (
          <button
            className="badge inst"
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
        <button
          className="icon add"
          title="Add modifier / support enforcer / blocker / part"
          aria-label="Add modifier / support enforcer / blocker / part"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(!menuOpen);
          }}
        >
          <ACTION_ICONS.addVolume size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
        <button
          className="icon split"
          title={splitLabel}
          aria-label={splitLabel}
          disabled={o.volumes.length > 0}
          onClick={(e) => {
            e.stopPropagation();
            select([o.id]);
            splitToObjects(o.id);
          }}
        >
          <ACTION_ICONS.splitToObjects size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
        <button
          className="icon split"
          title="Split to parts"
          aria-label="Split to parts"
          onClick={(e) => {
            e.stopPropagation();
            select([o.id]);
            splitToParts(o.id);
          }}
        >
          <ACTION_ICONS.splitToParts size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
      </div>
      {menuOpen && <AddVolumeMenu o={o} onClose={() => onMenu(false)} />}
      {o.instances.length > 1 && instancesShown && (
        <ul className="instance-list">
          {o.instances.map((inst, i) => (
            <li
              key={inst.id}
              className={`instance-row ${isSel && selectedInstanceId === inst.id ? 'selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
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
                <ACTION_ICONS.instanceToObject size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
              </button>
              <button
                className="icon"
                title="Split to objects"
                aria-label="Split to objects"
                onClick={(e) => {
                  e.stopPropagation();
                  selectInstance(o.id, inst.id);
                  splitToObjects(o.id);
                }}
              >
                <ACTION_ICONS.splitToObjects size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
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
                <ACTION_ICONS.delete size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {o.volumes.length > 0 && (
        <ul className="volume-list">
          {o.volumes.map((v) => (
            <li
              key={v.id}
              className={`volume-row ${isSel && selectedVolumeId === v.id ? 'selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                selectVolume(o.id, v.id);
              }}
              title={`${VOLUME_LABELS[v.type]}: ${v.name}`}
            >
              <span className={`vtype ${v.type}`}>{VOLUME_ICONS[v.type]}</span>
              <span className="name">{v.name}</span>
              <span className="muted small">{VOLUME_LABELS[v.type]}</span>
              {Object.keys(v.config).length > 0 && <span className="badge">⚙</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
