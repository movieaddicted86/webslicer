import { serverOnlyNote } from '@webslicer/shared';
import type { OptionDef } from '../api';

/**
 * A slicer option the server drops before the config reaches the slicer (SEC-1, T-024).
 *
 * Shown read-only with the reason, instead of a live editor: a preset (the browser's own, a vendor
 * bundle, a 3MF project) may legitimately carry the key, and a user who could edit it here would
 * expect the value to take effect – it never does, the server removes it in `mergeConfigs`.
 */
export function ServerOnlyOption({ def }: { def: OptionDef }) {
  const note = serverOnlyNote(def.key) ?? 'The server never passes this option to the slicer.';
  return (
    <div className="option block server-only" id={`opt-${def.key}`}>
      <label title={`${def.key}\n\n${note}`}>{def.label}</label>
      <div className="control">
        <p className="note">{note}</p>
      </div>
    </div>
  );
}
