import { useStore } from '../../state/store';
import { useId } from 'react';
import './Destination.css';

/**
 * The destination row of the context panel footer: the print host the finished G-code goes to, as the
 * send dialog would ask for it. Picking one here remembers it for the dialog; "Ask when sending"
 * (the default) leaves the dialog's own choice in place, so nothing changes for a user who never
 * touches this.
 *
 * Adding a host is not offered twice: the Printers dialog on the rail is its one home.
 */
export function Destination() {
  const printers = useStore((s) => s.physicalPrinters);
  const chosen = useStore((s) => s.sendDestination);
  const setDestination = useStore((s) => s.setSendDestination);
  const id = useId();
  const value = chosen && printers.some((p) => p.id === chosen) ? chosen : '';
  return (
    <div className="destination" data-testid="destination">
      <label htmlFor={id}>Destination</label>
      <select
        id={id}
        value={value}
        disabled={!printers.length}
        title={printers.length ? 'The print host the finished G-code is sent to' : 'No print host yet – add one in Printers'}
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">Ask when sending</option>
        {printers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.type})
          </option>
        ))}
      </select>
    </div>
  );
}
