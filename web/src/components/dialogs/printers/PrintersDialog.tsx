import { useState } from 'react';
import { Modal } from '../Modal';
import { PrinterHosts } from './PrinterHosts';
import { PrinterSetup, type PrinterSetupTab } from './PrinterSetup';
import './PrintersDialog.css';

/** The four tabs of the one Printers dialog, in the order the dialog shows them. */
export type PrintersTab = 'hosts' | PrinterSetupTab;

const TABS: Array<{ id: PrintersTab; label: string }> = [
  { id: 'hosts', label: 'My printers' },
  { id: 'vendor', label: 'Vendor profiles' },
  { id: 'filaments', label: 'Filaments' },
  { id: 'custom', label: 'Custom printer' },
];

/** The opening payload: which tab the entry point asks for (the rail's Printers, the preset dropdown). */
export interface PrintersPayload {
  tab?: PrintersTab;
}

/**
 * The one dialog behind "Printers" everywhere: the print hosts, the vendor profiles to install, the
 * filament filter and the custom printer are tabs of it, so the two dialogs that were both called
 * "printers" are gone. The entry points only name the tab they open on.
 */
export function PrintersDialog({ onClose, payload }: { onClose: () => void; payload?: PrintersPayload }) {
  const [tab, setTab] = useState<PrintersTab>(payload?.tab ?? 'hosts');

  return (
    <Modal title="Printers" onClose={onClose} wide>
      <div className="subtabs" role="tablist" aria-label="Printers">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`printers-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'hosts' ? <PrinterHosts /> : <PrinterSetup tab={tab} onClose={onClose} />}
    </Modal>
  );
}
