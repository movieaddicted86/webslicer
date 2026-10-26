import { useState } from 'react';
import { Modal } from '../Modal';
import { PrinterHosts } from './PrinterHosts';
import { PrinterSetup, type PrinterSetupTab } from './PrinterSetup';
import { SafetyStep } from './SafetyStep';
import { useStore } from '../../../state/store';
import './PrintersDialog.css';

/** The four tabs of the one Printers dialog, in the order the dialog shows them. */
export type PrintersTab = 'hosts' | PrinterSetupTab;

const TABS: Array<{ id: PrintersTab; label: string }> = [
  { id: 'hosts', label: 'My printers' },
  { id: 'vendor', label: 'Vendor profiles' },
  { id: 'filaments', label: 'Filaments' },
  { id: 'custom', label: 'Custom printer' },
];

/**
 * The opening payload: which tab the entry point asks for (the rail's Printers, the preset dropdown).
 *
 * `safety` is T-085's way into the safety question without a new menu entry: the Slice footer's
 * "no hotend type set" link opens this dialog straight on that step for the active printer preset.
 */
export interface PrintersPayload {
  tab?: PrintersTab;
  safety?: string;
}

/**
 * The one dialog behind "Printers" everywhere: the print hosts, the vendor profiles to install, the
 * filament filter and the custom printer are tabs of it, so the two dialogs that were both called
 * "printers" are gone. The entry points only name the tab they open on.
 *
 * The Safety step (T-085) is a step of this dialog, not a tab: it opens after a printer was installed
 * or created, and on its own through the footer's link.
 */
export function PrintersDialog({ onClose, payload }: { onClose: () => void; payload?: PrintersPayload }) {
  const [tab, setTab] = useState<PrintersTab>(payload?.tab ?? 'hosts');
  const record = useStore((s) => s.printerSafety);
  const savePrinterSafety = useStore((s) => s.savePrinterSafety);
  const [safety, setSafety] = useState<string | undefined>(payload?.safety);

  // the Safety step wins over the tab: it is the question the footer link asked for, and the tabs
  // underneath stay where they were for when it closes
  if (safety) {
    return (
      <Modal title="Printers" onClose={onClose} wide>
        <SafetyStep
          printerName={safety}
          initial={record[safety]}
          onSave={(profile) => {
            void savePrinterSafety(safety, profile).finally(onClose);
          }}
          onSkip={onClose}
        />
      </Modal>
    );
  }
  return (
    <Modal title="Printers" onClose={onClose} wide>
      <div className="subtabs" role="tablist" aria-label="Printers">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setSafety(undefined);
            }}
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
