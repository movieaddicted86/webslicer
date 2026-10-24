import type { ReactNode } from 'react';
import './ObjectToolbar.css';

/**
 * The toolbar above the object list (F-13): the row of icon buttons, wrapped when the column is
 * narrow and grouped by separators. The object section and Simple mode render their own buttons into
 * it, so the row's layout lives in one place and the two modes cannot drift apart.
 */
export function ObjectToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="object-toolbar" data-testid="object-toolbar">
      {children}
    </div>
  );
}
