import type { ReactNode } from 'react';

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

/** Ruhiger leerer Zustand direkt auf Schwarz: leerer Ring, ein Satz, optional ein Textknopf. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="emptystate" role="status">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="21" fill="none" stroke="var(--ring-track)" strokeWidth="9" /></svg>
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action && <button className="pillbtn addtx" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
