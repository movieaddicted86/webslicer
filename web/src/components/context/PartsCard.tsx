import { useState } from 'react';
import { useStore, VOLUME_LABELS, type PlaterObject, type PlaterVolume } from '../../state/store';
import { Icon } from '../../icons/Icon';
import { InlineName } from '../common/InlineName';
import { VOLUME_ICON_NAMES } from './volumes';
import { AddVolumeMenu } from './AddVolumeMenu';
import { VolumeManipulation } from './VolumeManipulation';
import { PanelCard } from './PanelCard';
import './PartsCard.css';

/**
 * The Parts card of the selected object: the add menu (part, modifier, support enforcer, support
 * blocker, negative volume), the list of its volumes and the manipulation of the picked one.
 *
 * The rows of the object list carried this before; the list is a plain overview now, so the parts
 * live where they are edited. A volume row still renames on a double-click, like an object row.
 */
export function PartsCard({ o, selectedVolumeId }: { o: PlaterObject; selectedVolumeId?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const volume = o.volumes.find((v) => v.id === selectedVolumeId);
  const label = 'Add modifier / support enforcer / blocker / part';
  return (
    <PanelCard
      title="Parts"
      icon="addVolume"
      testId="parts-card"
      aside={
        <button
          className="icon parts-add"
          data-testid="object-add-volume"
          title={label}
          aria-label={label}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="addVolume" size={16} />
        </button>
      }
    >
      {menuOpen && <AddVolumeMenu o={o} onClose={() => setMenuOpen(false)} />}
      {o.volumes.length === 0 ? (
        <div className="muted small">One solid. Add a part, a modifier, a support enforcer, a blocker or a negative volume.</div>
      ) : (
        <ul className="volume-list" data-testid="volume-list">
          {o.volumes.map((v) => (
            <VolumeRow key={v.id} o={o} v={v} selected={volume?.id === v.id} />
          ))}
        </ul>
      )}
      {volume && <VolumeManipulation o={o} v={volume} />}
    </PanelCard>
  );
}

/** One sub-volume of the object, renaming included (double-click the name). */
function VolumeRow({ o, v, selected }: { o: PlaterObject; v: PlaterVolume; selected: boolean }) {
  const selectVolume = useStore((s) => s.selectVolume);
  const renameVolume = useStore((s) => s.renameVolume);
  const removeVolume = useStore((s) => s.removeVolume);
  const [renaming, setRenaming] = useState(false);
  return (
    <li
      className={`volume-row ${selected ? 'selected' : ''}`}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onClick={() => selectVolume(o.id, v.id)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).closest('input, button')) return;
        e.preventDefault();
        selectVolume(o.id, v.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setRenaming(true);
      }}
      title={`${VOLUME_LABELS[v.type]}: ${v.name}`}
    >
      <span className={`vtype ${v.type}`} title={VOLUME_LABELS[v.type]}>
        <Icon name={VOLUME_ICON_NAMES[v.type]} size={14} />
      </span>
      {renaming ? (
        <InlineName
          initial={v.name}
          title="Name (Enter saves, Esc cancels)"
          onSave={(name) => {
            renameVolume(o.id, v.id, name);
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
      {/* the row's own action: the picked volume's settings and its removal, without leaving the list */}
      {Object.keys(v.config).length > 0 && (
        <span className="badge" title="This volume overrides print settings">
          <Icon name="overridden" size={12} />
        </span>
      )}
      <button
        className="icon row-action"
        data-testid="volume-remove"
        title="Delete volume"
        aria-label="Delete volume"
        onClick={(e) => {
          e.stopPropagation();
          removeVolume(o.id, v.id);
        }}
      >
        <Icon name="delete" size={14} />
      </button>
    </li>
  );
}
