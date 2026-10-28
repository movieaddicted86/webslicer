import { useStore } from '../../state/store';
import { fmtTime } from '../../format';
import { useMediaQuery } from '../left/useMediaQuery';
import './PhoneResult.css';

/** The width below which the sheet's footer is the only card the peek state shows. */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The result of the last slice, in the phone sheet's footer (T-092): with the sheet at `peek` the
 * footer is all the user sees, and the numbers of the job – time, filament, cost – otherwise live in
 * the object list's cards, which are a drawer on a phone. The row sits above the destination, so the
 * result and the way on (Send) are in one card and need no scroll.
 *
 * It renders nothing on a wide window: there the result is the left column's Sliced info card.
 */
export function PhoneResult() {
  const phone = useMediaQuery(PHONE_QUERY);
  const job = useStore((s) => s.job);
  if (!phone || job?.status !== 'done') return null;
  const info = job.info;
  const filamentMm = info?.filamentUsedMm?.reduce((a, b) => a + b, 0) ?? 0;
  const filament = info?.totalFilamentG ? `${info.totalFilamentG.toFixed(1)} g` : filamentMm ? `${(filamentMm / 1000).toFixed(2)} m` : '–';
  return (
    <div className="phone-result" data-testid="phone-result" role="status" aria-label="Slice result">
      <span className="phone-result-item" title="Estimated print time">
        <b>{info?.estimatedTime || fmtTime(info?.estimatedTimeSeconds)}</b>
      </span>
      <span className="phone-result-item" title="Filament the print uses">
        {filament}
      </span>
      {info?.totalFilamentCost ? (
        <span className="phone-result-item" title="Cost of the filament">
          {info.totalFilamentCost.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}
