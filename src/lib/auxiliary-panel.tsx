import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
const preference = 'moose.auxiliaryWidth';
const maximum = () => Math.max(320, window.innerWidth - 440);
const clamp = (width: number) => Math.min(maximum(), Math.max(320, width));
const savedWidth = () => {
  const stored = Number(localStorage.getItem(preference));
  return clamp(Number.isFinite(stored) && stored >= 320 ? stored : window.innerWidth * 0.44);
};

/** Shared geometry and focus lifecycle for the two persistent auxiliary panels. */
export function useAuxiliaryPanel(open: boolean, onClose: () => void) {
  const [width, setWidth] = useState(savedWidth);
  const [resizing, setResizing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const source = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const resize = () => setWidth((value) => clamp(value));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    if (open) {
      setWidth(savedWidth());
      source.current = document.activeElement as HTMLElement;
      panel.current?.focus({ preventScroll: true });
    } else if (
      source.current?.isConnected &&
      (document.activeElement === document.body || panel.current?.contains(document.activeElement))
    ) {
      source.current.focus({ preventScroll: true });
    }
  }, [open]);
  const resize = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    localStorage.setItem(preference, String(next));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    }
  };
  return { width, resizing, panel, onKeyDown, resize, setResizing };
}
export function PanelResizeHandle({
  label,
  width,
  onResize,
  onResizing,
}: {
  label: string;
  width: number;
  onResize(width: number): void;
  onResizing(value: boolean): void;
}) {
  const origin = useRef({ x: 0, width: 0 });
  return (
    <div
      className="resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={320}
      aria-valuemax={maximum()}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onResize(width + (event.key === 'ArrowLeft' ? 16 : -16));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        origin.current = { x: event.clientX, width };
        onResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          onResize(origin.current.width + origin.current.x - event.clientX);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onLostPointerCapture={() => onResizing(false)}
    />
  );
}
