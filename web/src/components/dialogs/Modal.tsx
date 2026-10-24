import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ACTION_ICONS } from '../common/icons';
import './Modal.css';

/** Everything inside a dialog that the Tab key may reach, in DOM order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements of a dialog, in DOM order. */
function focusTargets(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * The frame every dialog sits on. Behaviour is unchanged from before – Escape closes, a click on the
 * backdrop closes – plus the accessibility basics: `role="dialog"` with the title as its label,
 * focus moves into the dialog when it opens and back to whatever opened it when it closes, and Tab
 * stays inside (`aria-modal` alone does not stop the browser from tabbing out).
 */
export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = boxRef.current;
    if (!box) return;
    // the head holds only the close button, so the first control of the body is the better landing
    // spot; a dialog without one (an "About" text) keeps the focus on the box itself
    const body = box.querySelector<HTMLElement>('.modal-body') ?? box;
    (focusTargets(body)[0] ?? box).focus();
    return () => openerRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const box = boxRef.current;
      if (!box) return;
      const items = focusTargets(box).filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        box.focus();
        return;
      }
      const active = document.activeElement;
      const inside = box.contains(active);
      if (e.shiftKey ? !inside || active === items[0] : !inside || active === items[items.length - 1]) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" data-testid="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="modal"
      >
        <div className="modal-head">
          <h2 id={titleId} data-testid="modal-title">
            {title}
          </h2>
          <button className="icon" aria-label="Close" data-testid="modal-close" onClick={onClose}>
            <ACTION_ICONS.close size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
