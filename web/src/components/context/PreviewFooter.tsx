import { useStore } from '../../state/store';
import { useSliceGuard } from '../../state/useSliceGuard';
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
 *
 * A result whose plate no longer passes the checks must not leave the app: Send, Export and Save are
 * disabled then, with the reason as tooltip. The result itself stays readable in the preview, and so
 * does a merely stale one (the panel's "Slice again to update" note) – a plate edit is what blocks.
 */
export function PreviewFooter() {
  const job = useStore((s) => s.job);
  const physical = useStore((s) => s.physicalPrinters);
  const openDialog = useStore((s) => s.openDialog);
  const guard = useSliceGuard();
  if (job?.status !== 'done') return null;

  const blocked = guard.blocking.length > 0 ? `${guard.reason} Slice again once the plate passes the checks.` : undefined;
  const sendDisabled = blocked !== undefined || !physical.length;

  return (
    <div className="preview-footer-actions" data-testid="preview-actions">
      <button
        className="primary big"
        data-testid="send-button"
        disabled={sendDisabled}
        onClick={() => openDialog('sendToPrinter')}
        title={blocked ?? (physical.length ? 'Send the G-code to a print host' : 'Add a print host first')}
      >
        <Icon name="sendToHost" size={16} />
        Send to printer
      </button>
      {blocked ? (
        // a disabled anchor does not exist: without a result to export, the icon button stays a button
        <button
          className="button icon-action"
          data-testid="export-gcode"
          disabled
          title={`Export G-code – ${blocked}`}
          aria-label="Export G-code"
        >
          <Icon name="export" size={18} />
        </button>
      ) : (
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
      )}
      <button
        className="button icon-action"
        data-testid="save-gcode"
        disabled={blocked !== undefined}
        onClick={() => openDialog('library', 'saveGcode')}
        title={blocked ? `Save to library – ${blocked}` : 'Save to library'}
        aria-label="Save to library"
      >
        <Icon name="save" size={18} />
      </button>
    </div>
  );
}
