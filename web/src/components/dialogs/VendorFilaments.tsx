/**
 * One vendor of the wizard's filament step: the tick counts, the `All` / `None` buttons and the type
 * sections with their checkboxes. Presentational – the step owns the selection.
 */
import type { FilamentVendorGroup } from '../../filamentVisibility';
import type { QuickAction } from './FilamentStep';

/** How many of a vendor's filaments are ticked. */
export function tickedCount(group: FilamentVendorGroup, ticked: ReadonlySet<string>): number {
  return group.sections.reduce((n, s) => n + s.entries.filter((e) => ticked.has(e.name)).length, 0);
}

/** The number of filaments a vendor offers. */
function totalCount(group: FilamentVendorGroup): number {
  return group.sections.reduce((n, s) => n + s.entries.length, 0);
}

interface Props {
  group: FilamentVendorGroup;
  ticked: ReadonlySet<string>;
  onToggle: (name: string) => void;
  /** tick every filament of the vendor (`all`), none of them (`none`), or only one material type */
  onQuick: (group: FilamentVendorGroup, action: QuickAction, material?: string) => void;
}

export function VendorFilaments({ group, ticked, onToggle, onQuick }: Props) {
  return (
    <div className="filament-vendor">
      <div className="filament-vendor-head">
        <span className="name">{group.vendorName}</span>
        <span className="muted small">
          {tickedCount(group, ticked)} of {totalCount(group)} selected
        </span>
        <button className="small" onClick={() => onQuick(group, 'all')}>
          All
        </button>
        <button className="small" onClick={() => onQuick(group, 'none')}>
          None
        </button>
      </div>
      {group.sections.map((section) => (
        <div key={section.material} className="filament-type">
          <h4>
            {section.material}
            <button
              className="small"
              title={`Tick only the ${section.material} filaments of this vendor`}
              onClick={() => onQuick(group, 'only', section.material)}
            >
              Only this type
            </button>
          </h4>
          <div className="filament-entries">
            {section.entries.map((entry) => (
              <label key={entry.name} className={`checkbox small ${entry.compatible ? '' : 'muted'}`}>
                <input type="checkbox" checked={ticked.has(entry.name)} onChange={() => onToggle(entry.name)} /> {entry.name}
                {entry.compatible ? '' : ' (incompatible)'}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
