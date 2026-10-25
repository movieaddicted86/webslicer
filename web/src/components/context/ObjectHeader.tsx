import { useState } from 'react';
import { useStore, type PlaterObject } from '../../state/store';
import { objectInfo } from '../../plater/info';
import { fmt } from '../../format';
import { Icon } from '../../icons/Icon';
import { InlineName } from '../common/InlineName';
import './ObjectHeader.css';

/**
 * The header card of the object mode: the selected object with the mockup's picture tile, its name and
 * the one line that says how many copies and how big the object is, plus the pencil that renames it.
 *
 * It replaces the plain title row of the panel in object mode, so the panel answers "which object is
 * this" before the Transform card answers "where is it". The rename is the card's own: it writes
 * `renameObject` directly, so it also works while the left card is folded and the row's field is not
 * mounted.
 */
export function ObjectHeader({ o }: { o: PlaterObject }) {
  const renameObject = useStore((s) => s.renameObject);
  const [renaming, setRenaming] = useState(false);
  // a full mesh measurement: keep it off the render path of unrelated store changes
  const info = objectInfo(o);
  const instances = `${info.instances} ${info.instances === 1 ? 'instance' : 'instances'}`;
  return (
    <section className="object-header" data-testid="object-header" aria-label="Object">
      <span className="object-thumb" aria-hidden="true">
        <Icon name="objects" size={22} />
      </span>
      <div className="object-header-text">
        {renaming ? (
          <InlineName
            initial={o.name}
            className="object-header-name"
            title="Name (Enter saves, Escape cancels)"
            onSave={(name) => {
              if (name.trim() && name.trim() !== o.name) renameObject(o.id, name.trim());
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <b className="object-header-title" title={o.name}>
            {o.name}
          </b>
        )}
        <span className="object-header-meta" data-testid="object-header-meta">
          {instances} · {fmt(info.size[0])} × {fmt(info.size[1])} × {fmt(info.size[2])} mm
        </span>
      </div>
      <button className="icon" title="Rename (F2)" aria-label="Rename" data-testid="object-rename" onClick={() => setRenaming(true)}>
        <Icon name="rename" size={16} />
      </button>
    </section>
  );
}
