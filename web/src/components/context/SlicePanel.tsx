import { useStore, isModified } from '../../state/store';
import { useLimitIssues } from '../../state/useLimitIssues';
import { issueTargetOf } from '../../safety/configIssues';
import { plateIssues } from '../../plater/plateCheck';
import { toBool } from '../../values';
import './SlicePanel.css';
import '../common/progress.css';

/**
 * The plate checks in front of the slice (T-034): the issues PrusaSlicer would fail on (or that its
 * GUI warns about) are listed, and a blocking one disables "Slice now" with the reason as tooltip.
 * The server keeps its own error path – if the slicer still fails, its message is shown below.
 *
 * S1-e adds the configuration limits: the same check the server runs before slicing, over the current
 * presets. A block disables the button, a soft range only gets a badge; either way a click on the
 * issue opens the settings tab at the field that caused it.
 */
export function SlicePanel() {
  const objects = useStore((s) => s.objects);
  const presets = useStore((s) => s.presets);
  const printerBinary = useStore((s) => s.presets.printer.current.binary_gcode);
  const binaryGcode = useStore((s) => s.binaryGcode);
  const autosaveState = useStore((s) => s.autosaveState);
  const slice = useStore((s) => s.slice);
  const cancelSlice = useStore((s) => s.cancelSlice);
  const job = useStore((s) => s.job);
  const sliceDirty = useStore((s) => s.sliceDirty);
  const setView = useStore((s) => s.setView);
  const focusSetting = useStore((s) => s.focusSetting);
  const limitIssues = useLimitIssues();

  const issues = plateIssues(objects, presets.printer.current, presets.print.current);
  const blocking = issues.filter((i) => i.severity === 'block');
  const blockingLimits = limitIssues.filter((i) => i.severity === 'block');
  const warningLimits = limitIssues.filter((i) => i.severity === 'warn');
  const blockReason = [...blocking.map((i) => i.message), ...blockingLimits.map((i) => i.message)].join(' ');
  const running = job && (job.status === 'running' || job.status === 'queued');
  const anyModified = isModified(presets.print) || isModified(presets.printer) || presets.filament.some(isModified);

  return (
    <section className="slice-panel" data-testid="slice-panel">
      {issues.length > 0 && (
        <ul className={`plate-issues ${blocking.length ? 'blocking' : ''}`}>
          {issues.map((i) => (
            <li key={`${i.code}:${i.objectIds.join(',')}`} className={i.severity === 'block' ? 'warn' : 'muted small'} title={i.message}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      {limitIssues.length > 0 && (
        <ul className={`plate-issues limits ${blockingLimits.length ? 'blocking' : ''}`} aria-label="Setting problems">
          {limitIssues.map((i, n) => {
            const target = issueTargetOf(i);
            // the badge keeps a warning visible while it does not block; a block is red and blocks
            const label = i.severity === 'block' ? 'Blocks the slice' : 'Warning';
            return (
              <li key={`${i.rule}:${i.key}:${n}`} className={i.severity === 'block' ? 'warn' : 'muted small'} title={i.message}>
                <button type="button" className="link" onClick={() => focusSetting(target)}>
                  <span className={`badge-limit ${i.severity}`}>{label}</span> {i.message} <span className="muted small">({i.limit})</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {anyModified && <div className="muted small">Using modified (unsaved) settings.</div>}
      {objects.length > 0 && autosaveState !== 'idle' && (
        <div className="muted small" title="The plater is autosaved on the server and restored automatically after a reload.">
          {autosaveState === 'saving' ? 'Autosaving…' : autosaveState === 'saved' ? 'Autosaved' : 'Autosave failed'}
        </div>
      )}
      {toBool(printerBinary) && (
        <label className="checkbox small" title="Binary G-code is smaller and uploads faster, but cannot be previewed in the browser.">
          <input
            type="checkbox"
            checked={binaryGcode}
            onChange={(e) => useStore.setState({ binaryGcode: e.target.checked, sliceDirty: true })}
          />{' '}
          Export binary G-code (.bgcode) – no preview
        </label>
      )}
      {job && running ? (
        <>
          <div className="progress">
            <div className="bar" style={{ width: `${job.percent}%` }} />
            <span>
              {job.percent}% · {job.message}
            </span>
          </div>
          <button className="secondary" onClick={cancelSlice}>
            Cancel
          </button>
        </>
      ) : (
        <button
          className="primary big"
          data-testid="slice-button"
          onClick={slice}
          disabled={!objects.length || blocking.length > 0 || blockingLimits.length > 0}
          title={blockReason || undefined}
        >
          {sliceDirty || !job ? 'Slice now' : job.status === 'done' ? 'Slice again' : 'Slice now'}
        </button>
      )}
      {warningLimits.length > 0 && !blockingLimits.length && (
        <div className="muted small" title={warningLimits.map((i) => i.message).join(' ')}>
          {warningLimits.length === 1 ? '1 setting warning' : `${warningLimits.length} setting warnings`} – the slice still runs
        </div>
      )}
      {job && job.status === 'done' && !running && (
        <button className="secondary" onClick={() => setView('preview')}>
          Show preview / export
        </button>
      )}
      {job && job.status === 'error' && <div className="error small">{job.error}</div>}
    </section>
  );
}
