import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type CustomSelectOption<T extends string = string> = { value: T; label: string };

export function CustomSelect<T extends string>({ value, options, onChange, ariaLabel, disabled = false, className = '' }: {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, accent: '#4eaac8', accentRgb: '78,170,200' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const placeMenu = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const estimatedHeight = Math.min(options.length * 36 + 10, 250);
    const styles = window.getComputedStyle(buttonRef.current!);
    const top = bounds.bottom + estimatedHeight > window.innerHeight - 10
      ? Math.max(10, bounds.top - estimatedHeight - 5)
      : bounds.bottom + 5;
    setPosition({ left: bounds.left, top, width: bounds.width, accent: styles.getPropertyValue('--game-accent').trim() || '#4eaac8', accentRgb: styles.getPropertyValue('--game-accent-rgb').trim() || '78,170,200' });
  };

  useLayoutEffect(() => { if (open) placeMenu(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !(target as Element).closest?.('.custom-select-menu')) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
      window.removeEventListener('keydown', escape);
    };
  }, [open, options.length]);

  return <span className={`custom-select ${open ? 'open' : ''} ${className}`}>
    <button ref={buttonRef} type="button" className="custom-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{selected?.label}</span><ChevronDown size={14} />
    </button>
    {open && createPortal(<div className="custom-select-menu" role="listbox" aria-label={ariaLabel} style={{ left: position.left, top: position.top, minWidth: position.width, '--game-accent': position.accent, '--game-accent-rgb': position.accentRgb } as CSSProperties}>
      {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={13} />}</button>)}
    </div>, document.body)}
  </span>;
}
