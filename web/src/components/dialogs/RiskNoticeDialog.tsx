/**
 * The risk notice as a dialog of its own (T-085, AC-4): shown before the **first slice** when the
 * printer wizard was skipped, so the notice is not lost on a user who never opened it.
 *
 * It is the same card the wizard shows; Continue stores the acknowledgement server-side (per major
 * version), "Not now" keeps it away for this session and the next slice asks again.
 */
import { RiskNoticeCard } from './printers/RiskNoticeCard';
import { Modal } from './Modal';
import { useStore } from '../../state/store';

export function RiskNoticeDialog({ onClose }: { onClose: () => void }) {
  const riskNotice = useStore((s) => s.riskNotice);
  const acknowledgeRiskNotice = useStore((s) => s.acknowledgeRiskNotice);
  const dismissRiskNotice = useStore((s) => s.dismissRiskNotice);
  return (
    <Modal title="Before you print" onClose={onClose}>
      <RiskNoticeCard
        version={riskNotice?.version}
        onAcknowledge={() => void acknowledgeRiskNotice().finally(onClose)}
        onLater={() => {
          dismissRiskNotice();
          onClose();
        }}
      />
    </Modal>
  );
}
