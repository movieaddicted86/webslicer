/**
 * The Safety step of the printer wizard (T-085): two questions after the printer exists – what the
 * hotend is lined with, and the hottest bed the machine may use.
 *
 * The answer is stored per **printer preset** on the server, so it protects slicing and export as well,
 * not only the send path. The limits themselves live in `@webslicer/shared`; this step only collects the
 * answer, refuses an incomplete one and hands it on. "Ask me later" stores nothing – the Slice footer
 * then keeps its warning, which is what the task asks for.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ALL_METAL_MAX_HOTEND,
  MAX_BED_LIMIT,
  OTHER_HOTEND_MAX,
  OTHER_HOTEND_MIN,
  PTFE_MAX_HOTEND,
  RISK_NOTICE_URL,
} from '@webslicer/shared';
import { NumericField } from '../../common/NumericField';
import type { HotendType, PrinterSafetyProfile } from '../../../api';
import './SafetyStep.css';

/** The answer as the form holds it: the type, the typed "other" number and the optional bed limit. */
export interface SafetyDraft {
  hotendType: '' | HotendType;
  other: string;
  maxBed: string;
}

/** What the form starts from: the stored profile, or an empty answer. */
export function draftOf(profile: PrinterSafetyProfile | undefined): SafetyDraft {
  if (!profile) return { hotendType: '', other: '', maxBed: '' };
  return {
    hotendType: profile.hotendType,
    other: profile.hotendType === 'other' ? String(profile.maxHotend) : '',
    maxBed: profile.maxBed !== undefined ? String(profile.maxBed) : '',
  };
}

/** The profile an answer produces, or `undefined` while it is incomplete. */
export function profileOfDraft(draft: SafetyDraft): PrinterSafetyProfile | undefined {
  const bed = draft.maxBed.trim() === '' ? undefined : Number(draft.maxBed);
  if (bed !== undefined && (!Number.isFinite(bed) || bed < 0 || bed > MAX_BED_LIMIT)) return undefined;
  const maxBed = bed !== undefined && bed > 0 ? Math.round(bed) : undefined;
  if (draft.hotendType === 'ptfe' || draft.hotendType === 'all-metal') {
    const maxHotend = draft.hotendType === 'ptfe' ? PTFE_MAX_HOTEND : ALL_METAL_MAX_HOTEND;
    return { hotendType: draft.hotendType, maxHotend, ...(maxBed !== undefined && { maxBed }) };
  }
  if (draft.hotendType === 'other') {
    const other = Number(draft.other);
    if (draft.other.trim() === '' || !Number.isFinite(other) || other < OTHER_HOTEND_MIN || other > OTHER_HOTEND_MAX) return undefined;
    return { hotendType: 'other', maxHotend: Math.round(other), ...(maxBed !== undefined && { maxBed }) };
  }
  return undefined;
}

/** The message of an answer that cannot be stored yet, or `undefined` when it is complete. */
export function draftProblem(draft: SafetyDraft): string | undefined {
  if (!draft.hotendType) return 'Choose the hotend type – or skip this step with "Ask me later".';
  if (draft.hotendType === 'other') {
    const other = Number(draft.other);
    if (draft.other.trim() === '' || !Number.isFinite(other)) return `Enter the hotend limit (${OTHER_HOTEND_MIN}–${OTHER_HOTEND_MAX} °C).`;
    if (other < OTHER_HOTEND_MIN || other > OTHER_HOTEND_MAX)
      return `The hotend limit has to be between ${OTHER_HOTEND_MIN} and ${OTHER_HOTEND_MAX} °C.`;
  }
  const bed = draft.maxBed.trim() === '' ? undefined : Number(draft.maxBed);
  if (bed !== undefined && (!Number.isFinite(bed) || bed < 0 || bed > MAX_BED_LIMIT))
    return `The bed limit has to be between 0 and ${MAX_BED_LIMIT} °C.`;
  return undefined;
}

interface Props {
  /** the printer preset the answer belongs to */
  printerName: string;
  initial: PrinterSafetyProfile | undefined;
  /** "Step 2 of 3 – Safety" and the like; the custom printer numbers its steps, a re-open does not */
  stepLabel?: string;
  saving?: boolean;
  onSave: (profile: PrinterSafetyProfile) => void;
  /** "Ask me later": nothing is stored */
  onSkip: () => void;
  onBack?: () => void;
}

export function SafetyStep({ printerName, initial, stepLabel, saving, onSave, onSkip, onBack }: Props) {
  const [draft, setDraft] = useState<SafetyDraft>(() => draftOf(initial));
  const first = useRef<HTMLSelectElement>(null);
  // the dialog keeps the focus it took when it opened; a step change has to land on its first field
  useEffect(() => first.current?.focus(), []);
  const problem = draftProblem(draft);
  const profile = profileOfDraft(draft);
  const set = (change: Partial<SafetyDraft>) => setDraft({ ...draft, ...change });
  const limitOf = (type: HotendType): number | undefined => {
    if (type === 'ptfe') return PTFE_MAX_HOTEND;
    if (type === 'all-metal') return ALL_METAL_MAX_HOTEND;
    const other = Number(draft.other);
    return draft.other.trim() !== '' && Number.isFinite(other) ? other : undefined;
  };

  return (
    <div className="safety-step" data-testid="safety-step">
      <h3>Safety for “{printerName}”</h3>
      <p className="muted small">
        WebSlicer checks every temperature against these limits before it slices – also when you only export G-code and never send the file
        to a printer. Read the{' '}
        <a href={RISK_NOTICE_URL} target="_blank" rel="noreferrer">
          safety page
        </a>{' '}
        for what the checks cannot see.
      </p>
      <label htmlFor="safety-hotend-type">
        Hotend type{' '}
        <select
          id="safety-hotend-type"
          ref={first}
          value={draft.hotendType}
          onChange={(e) => set({ hotendType: e.target.value as SafetyDraft['hotendType'] })}
        >
          <option value="">— choose —</option>
          <option value="ptfe">PTFE-lined hotend (max {PTFE_MAX_HOTEND} °C)</option>
          <option value="all-metal">All-metal hotend (up to the global {ALL_METAL_MAX_HOTEND} °C)</option>
          <option value="other">
            Other limit ({OTHER_HOTEND_MIN}–{OTHER_HOTEND_MAX} °C)
          </option>
        </select>
      </label>
      {draft.hotendType === 'other' && (
        <label htmlFor="safety-hotend-limit">
          Max hotend °C{' '}
          <NumericField
            id="safety-hotend-limit"
            text={draft.other}
            onText={(text) => set({ other: text })}
            apply="input"
            keepText
            min={OTHER_HOTEND_MIN}
            max={OTHER_HOTEND_MAX}
          />
        </label>
      )}
      {draft.hotendType && (
        <div className="muted small" data-testid="safety-hotend-limit-note">
          Hotend limit: {limitOf(draft.hotendType as HotendType) ?? '—'} °C
        </div>
      )}
      <label htmlFor="safety-max-bed">
        Max bed °C (optional){' '}
        <NumericField
          id="safety-max-bed"
          text={draft.maxBed}
          onText={(text) => set({ maxBed: text })}
          apply="input"
          keepText
          min={0}
          max={MAX_BED_LIMIT}
          placeholder="none"
        />
      </label>
      <p className="muted small">
        A PTFE-lined hotend is damaged from about {PTFE_MAX_HOTEND} °C; the limit cannot be raised beyond the global {ALL_METAL_MAX_HOTEND}{' '}
        °C.
      </p>
      {problem && draft.hotendType !== '' && <div className="warn small">{problem}</div>}
      <div className="modal-actions" data-testid="modal-actions">
        {stepLabel && <span className="muted small">{stepLabel}</span>}
        {onBack && <button onClick={onBack}>Back</button>}
        <button onClick={onSkip} data-testid="safety-skip">
          Ask me later
        </button>
        <button className="primary" data-testid="modal-primary" disabled={saving || !profile} onClick={() => profile && onSave(profile)}>
          Save
        </button>
      </div>
    </div>
  );
}
