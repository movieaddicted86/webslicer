import type { ReactNode } from 'react';
import './GroupTitle.css';

/**
 * A group title of the context panel: 11 px uppercase in the muted colour with a rule that takes the
 * rest of the row, as the mockup draws it. The groups are the blocks inside a card (Walls & perimeters,
 * Infill, Supports & adhesion, Show …), so a long card reads as named sections and not one form.
 */
export function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <div className="group-title">
      <span>{children}</span>
    </div>
  );
}
