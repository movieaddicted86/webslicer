import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { aboutShortcuts } from '../../three/viewer/shortcuts';
import { updateAvailable, updateLabel } from '@webslicer/shared';

/** Version, engine info, licence note and the shortcut table the key handler reads as well. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  // T-058: the same answer the top bar reads; without a status (or when current) no row appears
  const update = useStore((s) => s.updateStatus);
  return (
    <Modal title="About WebSlicer" onClose={onClose}>
      <p>
        <b>WebSlicer</b> {info?.version} – a web frontend for the PrusaSlicer slicing engine.
      </p>
      <table className="kv">
        <tbody>
          <tr>
            <td>Slicer engine</td>
            <td>PrusaSlicer {info?.slicerVersion}</td>
          </tr>
          <tr>
            <td>Vendor bundles</td>
            <td>{info?.vendors}</td>
          </tr>
          <tr>
            <td>Parallel jobs</td>
            <td>{info?.maxJobs}</td>
          </tr>
          {update && updateAvailable(update) && (
            <tr className="about-update">
              <td>Update</td>
              <td>
                <a href={update.url} target="_blank" rel="noreferrer">
                  {updateLabel(update)}
                </a>
                {update.checkedAt && <span className="muted small"> (checked {new Date(update.checkedAt).toLocaleString()})</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted small">
        PrusaSlicer is © Prusa Research, licensed under AGPL-3.0. WebSlicer is an independent project and is not affiliated with Prusa
        Research.
      </p>
      <p className="small">
        {/* the one shortcut table the key handler reads as well – the two cannot drift apart */}
        Shortcuts:{' '}
        {aboutShortcuts().map((s, i) => (
          <span key={`${s.id}-${i}`}>
            {i > 0 && ' · '}
            {s.range ? (
              <>
                <kbd>{s.keys[0]}</kbd>…<kbd>{s.keys[1]}</kbd>
              </>
            ) : (
              s.keys.map((k, ki) => (
                <span key={k}>
                  {ki > 0 && '+'}
                  <kbd>{k}</kbd>
                </span>
              ))
            )}{' '}
            {s.label}
          </span>
        ))}
      </p>
    </Modal>
  );
}
