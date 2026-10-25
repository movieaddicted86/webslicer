import { useStore } from '../../state/store';
import { api } from '../../api';
import { Icon } from '../../icons/Icon';
import './PreviewFooter.css';

/**
 * The footer of the preview: the destination the G-code goes to and the actions on the result – Send
 * to printer as the one accent, the export as the icon button beside it and "Save to library" as the
 * second icon.
 *
 * The mockup puts the two actions next to the destination in the footer card, so the result cards on
 * the left stay a reading of the numbers. The dialog behind each button is unchanged.
 */
export function PreviewFooter() {
  const job = useStore((s) => s.job);
  const physical = useStore((s) => s.physicalPrinters);
  const openDialog = useStore((s) => s.openDialog);
  if (job?.status !== 'done') return null;
  return (
    <div className="preview-footer-actions" data-testid="preview-actions">
      <button
        className="primary big"
        data-testid="send-button"
        disabled={!physical.length}
        onClick={() => openDialog('sendToPrinter')}
        title={physical.length ? 'Send the G-code to a print host' : 'Add a print host first'}
      >
        <Icon name="sendToHost" size={16} />
        Send to printer
      </button>
      <a
        className="button icon-action"
        data-testid="export-gcode"
        href={api.gcodeUrl(job.id, true)}
        download
        title="Export G-code"
        aria-label="Export G-code"
      >
        <Icon name="export" size={18} />
      </a>
      <button
        className="button icon-action"
        data-testid="save-gcode"
        onClick={() => openDialog('library', 'saveGcode')}
        title="Save to library"
        aria-label="Save to library"
      >
        <Icon name="save" size={18} />
      </button>
    </div>
  );
}
