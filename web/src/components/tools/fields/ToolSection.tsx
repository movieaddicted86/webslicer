/** A titled group of fields inside a tool panel (T-046). */
import type { ReactNode } from 'react';

export function ToolSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="tool-section">
      {title && <div className="tool-section-title">{title}</div>}
      {children}
    </section>
  );
}
