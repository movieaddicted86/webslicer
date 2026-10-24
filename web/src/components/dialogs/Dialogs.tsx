import { useStore, type PendingPresetSwitch } from '../../state/store';
import { LibraryDialog, type LibraryMode } from './LibraryDialog';
import { AddPrinterDialog } from './AddPrinterDialog';
import { PhysicalPrintersDialog } from './PhysicalPrintersDialog';
import { SendToPrinterDialog } from './SendToPrinterDialog';
import { SavePresetDialog } from './SavePresetDialog';
import { RenamePresetDialog } from './RenamePresetDialog';
import { PresetImportDialog } from './PresetImportDialog';
import { ObjectSettingsDialog } from './ObjectSettingsDialog';
import { AboutDialog } from './AboutDialog';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import type { PresetType } from '../../api';

/**
 * The one dialog slot of the app (F-14): `state.dialog` decides which of the dialogs is shown, every
 * dialog lives in its own file on the shared `Modal` frame.
 */
export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const payload = useStore((s) => s.dialogPayload);
  const close = useStore((s) => s.closeDialog);
  switch (dialog) {
    case 'addPrinter':
      return <AddPrinterDialog onClose={close} />;
    case 'physicalPrinters':
      return <PhysicalPrintersDialog onClose={close} />;
    case 'sendToPrinter':
      return <SendToPrinterDialog onClose={close} />;
    case 'savePreset':
      return <SavePresetDialog onClose={close} payload={payload as { type: PresetType; extruderIdx: number }} />;
    case 'renamePreset':
      return <RenamePresetDialog onClose={close} payload={payload as { type: PresetType; name: string }} />;
    case 'importPresets':
      return <PresetImportDialog onClose={close} />;
    case 'objectSettings':
      return <ObjectSettingsDialog onClose={close} {...(payload as { objectId: string; volumeId?: string; rangeId?: string })} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'library':
      return <LibraryDialog onClose={close} mode={(payload as LibraryMode) || 'open'} />;
    case 'unsavedChanges':
      return <UnsavedChangesDialog onClose={close} payload={payload as PendingPresetSwitch} />;
    default:
      return null;
  }
}
