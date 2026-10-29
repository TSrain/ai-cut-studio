import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

/** Fixed-delay help, including for disabled controls, outside clipped toolbars. */
export function Tooltip({text, children}: {text: string; children: React.ReactElement}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({left: 0, top: 0});
  const cancel = () => clearTimeout(timer.current);
  const hide = () => {cancel(); setOpen(false);};
  const show = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), 1000);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape') hide();};
    window.addEventListener('keydown', escape);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      cancel();
      window.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect(), b = bubble.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(a.left + a.width / 2 - b.width / 2, innerWidth - b.width - 8)),
      top: a.top >= b.height + 16 ? a.top - b.height - 8 : a.bottom + 8,
    });
  }, [open, text]);
  return <span ref={anchor} className="toolbar-help-anchor"
    onPointerEnter={show} onPointerLeave={hide} onPointerDownCapture={hide}
    onFocus={show} onBlur={hide}>
    {React.cloneElement(children, {'aria-describedby': open ? id : undefined})}
    {open && createPortal(<div ref={bubble} id={id} role="tooltip" className="toolbar-help" style={position}>{text}</div>, document.body)}
  </span>;
}
