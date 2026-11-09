import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

export interface RowMenu { onEdit: () => void; onDuplicate?: () => void; onDelete: () => void }
const HOLD_MS = 450;

/**
 * Zeile einer Buchung. Tippen öffnet sie; Gedrückthalten öffnet ein Menü (Bearbeiten, Duplizieren, Löschen)
 * über einem verschwommenen Hintergrund. Wischen zum Löschen gibt es nicht (seitliches Wischen blättert die Reiter).
 */
export function SwipeRow({ children, onTap, selected, className = '', menu, fresh, txid }: { children: ReactNode; onTap: () => void; onDelete?: () => void; disabled?: boolean; selected?: boolean; className?: string; label?: string; menu?: RowMenu; fresh?: boolean; txid?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const [open, setOpen] = useState<{ rect: DOMRect; drill: boolean } | null>(null);
  const cancel = () => { window.clearTimeout(timer.current); timer.current = 0; start.current = null; ref.current?.classList.remove('holding'); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    fired.current = true; cancel();
    setOpen({ rect: el.getBoundingClientRect(), drill: !!el.closest('.drill') });
  };
  const hold = menu ? {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      ref.current?.classList.add('holding');
      timer.current = window.setTimeout(show, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => { const s0 = start.current; if (s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 8) cancel(); },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!open) show(); }
  } : {};
  return (
    <div className={'swipe' + (fresh ? ' fresh' : '')} data-txid={txid}>
      <button ref={ref} className={'item' + (className ? ' ' + className : '') + (selected ? ' picked' : '') + (open ? ' lifted' : '')} {...hold}
        onClick={() => { if (fired.current) { fired.current = false; return; } onTap(); }}>{children}</button>
      {open && menu && <RowMenuOverlay rect={open.rect} drill={open.drill} className={className} menu={menu} onClose={() => setOpen(null)}>{children}</RowMenuOverlay>}
    </div>
  );
}

/** Menü nach dem Gedrückthalten: Zeile angehoben, darunter (oder darüber) die Aktionen, Rest verschwommen. */
function RowMenuOverlay({ rect, drill, className, menu, onClose, children }: { rect: DOMRect; drill: boolean; className: string; menu: RowMenu; onClose: () => void; children: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setClosing(true); window.setTimeout(onClose, 160); }, [onClose]);
  useEffect(() => {
    document.body.classList.add('lpopen');
    first.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => { document.body.classList.remove('lpopen'); window.removeEventListener('keydown', key); };
  }, [close]);
  const act = (f: () => void) => () => { close(); f(); };
  const vh = window.innerHeight;
  const below = vh - rect.bottom > 200 || rect.top < 220;
  // Zeile bleibt an ihrem Platz; ist sie zu weit unten, rückt sie so weit hoch, dass das Menü darunter passt
  const top = Math.max(12, Math.min(rect.top, vh - 200 - rect.height));
  const menuPos: React.CSSProperties = below ? { top: top + rect.height + 8 } : { bottom: vh - rect.top + 8 };
  const host = document.querySelector('.app') ?? document.body;
  return createPortal(
    <div className={'lpov' + (closing ? ' out' : '')} role="dialog" aria-modal="true" aria-label="Aktionen für Buchung" onClick={close} onContextMenu={(e) => e.preventDefault()}>
      <div className={'lpprev' + (drill ? ' drill' : '')} style={{ top: below ? top : rect.top, left: rect.left, width: rect.width }} aria-hidden="true">
        <div className="swipe"><div className={'item ' + className}>{children}</div></div>
      </div>
      <div className="lpmenu" role="menu" style={{ ...menuPos, left: Math.max(12, rect.left + 8), width: Math.min(260, rect.width - 16) }} onClick={(e) => e.stopPropagation()}>
        <button ref={first} role="menuitem" onClick={act(menu.onEdit)}>Bearbeiten<Icon name="edit" size={18} /></button>
        {menu.onDuplicate && <button role="menuitem" onClick={act(menu.onDuplicate)}>Duplizieren<Icon name="copy" size={18} /></button>}
        <button role="menuitem" className="danger" onClick={act(menu.onDelete)}>Löschen<Icon name="trash" size={18} /></button>
      </div>
    </div>,
    host
  );
}
