import { preflightSummary, type PreflightIssue } from '@webslicer/shared';
import { useStore } from '../../state/store';

/** "1 blocking, 0 warnings" / "no preflight findings" for the summary line. */
function summaryText(blocking: number, warnings: number): string {
  if (!blocking && !warnings) return 'no findings';
  const parts: string[] = [];
  if (blocking) parts.push(blocking === 1 ? '1 blocking' : `${blocking} blocking`);
  if (warnings) parts.push(warnings === 1 ? '1 warning' : `${warnings} warnings`);
  return parts.join(', ');
}

/**
 * The G-code preflight of the finished job (S1-c): one line with the counts and a `<details>` with
 * the findings, so a forbidden command or a suspicious temperature is visible in the preview without
 * opening the send dialog. An old job has no stored result – it shows the "not scanned" note only
 * when the output is binary G-code.
 */
export function Preflight() {
  const job = useStore((s) => s.job);
  const preflight = job?.info?.preflight;
  if (!job || !preflight) {
    const binary = job?.outputName.toLowerCase().endsWith('.bgcode');
    return binary ? <div className="muted small">Preflight: not scanned (binary G-code)</div> : null;
  }
  const summary = preflightSummary(preflight);
  const total = summary.blocking + summary.warnings;
  // the scan keeps only the first findings of a rule; the counts name the rest
  const capped = Object.entries(preflight.counts).some(([rule, count]) => count > preflight.issues.filter((i) => i.rule === rule).length);
  return (
    <details className={summary.blocking ? 'preflight blocking' : 'preflight'} open={summary.blocking > 0}>
      <summary>
        Preflight:{' '}
        {summary.blocking ? <b>{summaryText(summary.blocking, summary.warnings)}</b> : summaryText(summary.blocking, summary.warnings)}
      </summary>
      {total === 0 ? (
        <div className="muted small">Nothing to report.</div>
      ) : (
        <ul>
          {preflight.issues.map((issue: PreflightIssue, index: number) => (
            <li key={`${issue.rule}-${index}`} className={issue.severity === 'block' ? 'error' : undefined}>
              {issue.message}
              {issue.text ? (
                <div className="muted small gcode-line">
                  Line {issue.line}: {issue.text}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {capped ? <div className="muted small">Only the first findings of each rule are listed.</div> : null}
    </details>
  );
}
