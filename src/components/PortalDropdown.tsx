import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortalDropdownProps {
  anchorEl: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  align?: 'right' | 'left' | 'center';
  offset?: number; // px
  minWidth?: number | string;
  closing?: boolean;
  durationMs?: number; // default 300-500
  /** Optional override for easing timing function */
  easing?: string; // default cubic-bezier(.22,.9,.3,1)
}

export default function PortalDropdown(props: PortalDropdownProps) {
  const { anchorEl, onClose, children, className, align = 'right', offset = 8, minWidth, closing = false, durationMs = 300, easing = 'cubic-bezier(.22,.9,.3,1)' } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Start slightly above with reduced opacity & scale for smoother entrance
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0, transform: 'translateY(-8px) scale(.98)', opacity: 0 });
  const [mounted, setMounted] = useState(false);
  const [animate, setAnimate] = useState(false); // gate transitions until stable position computed

  const compute = () => {
    const rect = anchorEl.getBoundingClientRect();
    const next: React.CSSProperties = { position: 'fixed', top: Math.round(rect.bottom + offset) };
    const baseX = align === 'center' ? 'translateX(-50%) ' : '';
    if (align === 'right') {
      next.right = Math.round(window.innerWidth - rect.right);
    } else if (align === 'left') {
      next.left = Math.round(rect.left);
    } else {
      next.left = Math.round(rect.left + rect.width / 2);
    }
    if (minWidth) next.minWidth = typeof minWidth === 'number' ? `${minWidth}px` : String(minWidth);

    setStyle((prev) => {
      // Extract current Y translate to prevent jump during scroll/resize
      const current = String(prev.transform || '');
      const matchY = current.match(/translateY\(([-\d.]+px)\)/);
      const yVal = matchY ? matchY[1] : '-8px';
      const scaleMatch = current.match(/scale\(([^)]+)\)/);
      const scaleVal = scaleMatch ? scaleMatch[1] : '1';
      return { ...next, transform: `${baseX}translateY(${yVal}) scale(${scaleVal})`, opacity: prev.opacity };
    });
  };

  useLayoutEffect(() => {
    compute();
    // Recompute on resize/scroll
    const onResize = () => compute();
    const onScroll = () => compute();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorEl, offset, align, minWidth]);

  useEffect(() => {
    setMounted(true);
    // Next frame: animate to visible state
    const r = requestAnimationFrame(() => setStyle((s) => {
      const baseX = align === 'center' ? 'translateX(-50%) ' : '';
      // Always reset to target visible transform
      return { ...s, transform: `${baseX}translateY(0) scale(1)`, opacity: 1 };
    }));
    // Enable transitions AFTER we schedule the transform change so initial positioning has no lateral tween
  requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate close when parent sets closing=true
  useEffect(() => {
    if (closing) {
      const baseX = align === 'center' ? 'translateX(-50%) ' : '';
      setStyle((s) => ({ ...s, transform: `${baseX}translateY(-8px) scale(.98)`, opacity: 0 }));
    }
  }, [closing, align]);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return; // inside panel
      if (anchorEl.contains(t as Node)) return; // click the button again -> let parent toggle
      onClose();
    };
    document.addEventListener('mousedown', handleDown, true);
    return () => document.removeEventListener('mousedown', handleDown, true);
  }, [anchorEl, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{
        ...style,
        transition: animate ? `transform ${durationMs}ms ${easing}, opacity ${durationMs}ms ${easing}` : 'none',
        willChange: 'transform, opacity',
        pointerEvents: mounted ? 'auto' : 'none',
        zIndex: 9999,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
