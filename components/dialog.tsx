'use client';
import {useEffect, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';

const openDialogs: symbol[] = [];

export default function Dialog({title, children, onClose, wide = false}: {title: string; children: ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const self = Symbol('dialog'); openDialogs.push(self);
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]') || []).filter(el => !el.hasAttribute('disabled'));
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    const handler = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== self) return;
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const items = focusable(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
      if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    };
    document.addEventListener('keydown', handler);
    return () => {openDialogs.splice(openDialogs.indexOf(self), 1); cancelAnimationFrame(frame); if (!openDialogs.length) document.body.style.overflow = ''; document.removeEventListener('keydown', handler); previous?.focus();};
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) onClose();}}>
    <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <span className="sheet-grabber" aria-hidden="true"/>
      <div className="dialog-heading"><h2>{title}</h2><button className="icon-button close-button" aria-label="Close" onClick={onClose}><X size={18} strokeWidth={2.4}/></button></div>
      {children}
    </div>
  </div>;
}
