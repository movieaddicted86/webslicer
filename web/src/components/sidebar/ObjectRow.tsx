import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, VOLUME_LABELS, type PlaterObject, type PlaterVolume } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { objectIsOutside } from '../../plater/plateCheck';
import { fmt } from '../../format';
import { ACTION_ICONS } from '../common/icons';
import { VOLUME_ICONS } from './volumes';
import { AddVolumeMenu } from './AddVolumeMenu';
import './ObjectRow.css';

/**
 * An inline text field for renaming (T-042): Enter or blur saves, Esc cancels. It starts in edit mode
 * and selects its text, so typing replaces the old name – PrusaSlicer's rename behaves the same.
 */
export function InlineName({
  initial,
  onSave,
  onCancel,
  className,
  title,
}: {
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // a cancelled edit must not report a blur save when the field unmounts
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onSave(text);
    else onCancel();
  };
  return (
    <input
      ref={input}
      className={`inline-name ${className || ''}`}
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/**
 * One row of the object list with everything that hangs off it: the visibility checkbox, the
 * badges, the add menu and the instance / volume sub-lists. Double-clicking a name (or F2 on the
 * selected object) renames it; the info line shows size, volume and the manifold state (T-042).
 */
export function ObjectRow({
  o,
  menuOpen,
  onMenu,
  instancesShown,
  onToggleInstances,
  renaming,
  onRename,
  onStopRename,
}: {
  o: PlaterObject;
  menuOpen: boolean;
  /** opens / closes the add-volume menu of this row */
  onMenu: (open: boolean) => void;
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
  const selectVolume = useStore((s) => s.selectVolume);
  const selectInstance = useStore((s) => s.selectInstance);
  const removeInstance = useStore((s) => s.removeInstance);
  const instanceToObject = useStore((s) => s.instanceToObject);
  const splitToObjects = useStore((s) => s.splitToObjects);
  const splitToParts = useStore((s) => s.splitToParts);
  const update = useStore((s) => s.updateObject);
  const renameObject = useStore((s) => s.renameObject);
  const renameVolume = useStore((s) => s.renameVolume);
  const recordHistory = useStore((s) => s.recordHistory);
  const isSel = selectedIds.includes(o.id);
  // the row's buttons show a symbol only, so each tooltip is also its accessible name
  const instancesLabel = `${o.instances.length} instances – click to show them`;
  const splitLabel = o.volumes.length ? 'Remove modifiers and parts first' : 'Split to objects';
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
          <span className="name" title={`${o.name} – double-click to rename`}>
            {o.name}
          </span>
        )}
        {o.extruder > 0 && <span className="badge">E{o.extruder}</span>}
        {Object.keys(o.config).length > 0 && <span className="badge">⚙</span>}
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
        <button
          className="icon add"
          data-testid="object-add-volume"
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
          data-testid="object-split-objects"
          title={splitLabel}
          aria-label={splitLabel}
          disabled={o.volumes.length > 0}
          onClick={(e) => {
            e.stopPropagation();
            select([o.id]);
            void splitToObjects(o.id);
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
            void splitToParts(o.id);
          }}
        >
          <ACTION_ICONS.splitToParts size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
        </button>
      </div>
      <div
        className="object-info muted small"
        data-testid="object-info"
        title="Size, volume, triangles, manifold state and instances of this object"
      >
        {fmt(info.size[0])} × {fmt(info.size[1])} × {fmt(info.size[2])} mm · {fmt(info.volume, 2)} cm³ · {info.triangles.toLocaleString()}{' '}
        triangles · {info.instances} {info.instances === 1 ? 'instance' : 'instances'}
        {info.openEdges > 0 && (
          <span className="not-manifold" title="The mesh has boundary edges – the slicer will repair or refuse it">
            {' '}
            · Not manifold – {info.openEdges} open edges
          </span>
        )}
      </div>
      {menuOpen && <AddVolumeMenu o={o} onClose={() => onMenu(false)} />}
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
                <ACTION_ICONS.instanceToObject size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
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
            <VolumeRow
              key={v.id}
              o={o}
              v={v}
              selected={isSel && selectedVolumeId === v.id}
              onSelect={() => selectVolume(o.id, v.id)}
              onRename={(name) => renameVolume(o.id, v.id, name)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One sub-volume of the row, renaming included (double-click the name). */
function VolumeRow({
  o,
  v,
  selected,
  onSelect,
  onRename,
}: {
  o: PlaterObject;
  v: PlaterVolume;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <li
      className={`volume-row ${selected ? 'selected' : ''}`}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).closest('input, button')) return;
        e.preventDefault();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setRenaming(true);
      }}
      title={`${VOLUME_LABELS[v.type]}: ${v.name}`}
    >
      <span className={`vtype ${v.type}`}>{VOLUME_ICONS[v.type]}</span>
      {renaming ? (
        <InlineName
          initial={v.name}
          title="Name (Enter saves, Esc cancels)"
          onSave={(name) => {
            onRename(name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className="name" title={`${o.name}: ${v.name} – double-click to rename`}>
          {v.name}
        </span>
      )}
      <span className="muted small">{VOLUME_LABELS[v.type]}</span>
      {Object.keys(v.config).length > 0 && <span className="badge">⚙</span>}
    </li>
  );
}
