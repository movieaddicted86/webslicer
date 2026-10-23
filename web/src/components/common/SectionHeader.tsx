import type { ReactNode } from 'react';
import './SectionHeader.css';

/**
 * The heading of a sidebar section (F-13): a title on the left, the tools or the one action of the
 * section on the right. The sidebar, the objects panel and the preview panel all had their own copy
 * of this markup.
 */
export function SectionHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section-head">
      <span>{title}</span>
      {children}
    </div>
  );
}
