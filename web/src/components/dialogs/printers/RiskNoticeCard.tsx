/**
 * The one-time risk notice (T-085, AC-4): the short sentence of `riskNotice.ts`, a link to the safety
 * page and the "I understand" checkbox that enables Continue.
 *
 * It is shown by the printer wizard (and, if the wizard was skipped, before the first slice), and the
 * acknowledgement is stored **server-side** per major version – so it survives a reload and a new
 * browser, and it does not nag again after a minor release. The About dialog keeps its own notice; this
 * card is the one that asks for a click.
 */
import { useState } from 'react';
import { RISK_NOTICE_SHORT, RISK_NOTICE_URL } from '@webslicer/shared';
import './RiskNoticeCard.css';

interface Props {
  /** the version the card is shown for, as the server reports it */
  version?: string;
  onAcknowledge: () => void;
  /** "Not now": the card stays away for this session, and the first slice asks again */
  onLater?: () => void;
  acknowledging?: boolean;
}

export function RiskNoticeCard({ version, onAcknowledge, onLater, acknowledging }: Props) {
  const [understood, setUnderstood] = useState(false);
  return (
    <section className="risk-card" data-testid="risk-notice-card" aria-label="Risk notice">
      <h3>Before you print</h3>
      <p className="small">{RISK_NOTICE_SHORT}</p>
      <p className="small">
        <a href={RISK_NOTICE_URL} target="_blank" rel="noreferrer">
          What the safety checks cover
        </a>
        {version ? <span className="muted small"> · acknowledged per major version (now {version})</span> : null}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          data-testid="risk-notice-understood"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
        />{' '}
        I understand
      </label>
      <div className="modal-actions" data-testid="modal-actions">
        {onLater && (
          <button onClick={onLater} data-testid="risk-notice-later">
            Not now
          </button>
        )}
        <button className="primary" data-testid="risk-notice-continue" disabled={!understood || acknowledging} onClick={onAcknowledge}>
          Continue
        </button>
      </div>
    </section>
  );
}
