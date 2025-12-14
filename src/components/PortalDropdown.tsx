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
    const panelH = panelRef.current?.offsetHeight || 0;
    const padding = 16; // viewport edge padding
    // default open downward below anchor
    const next: React.CSSProperties = { position: 'fixed', top: Math.round(rect.bottom + offset) };
    const baseX = align === 'center' ? 'translateX(-50%) ' : '';
    
    // Mobile viewport constraint: prevent overflow
    const isMobile = window.innerWidth <= 768;
    
    if (align === 'right') {
      next.right = Math.round(window.innerWidth - rect.right);
      // Ensure minimum right padding on mobile
      if (isMobile && (next.right as number) < padding) {
        next.right = padding;
      }
      // Constrain width if would overflow horizontally
      const availableWidth = window.innerWidth - (next.right as number) - padding;
      if (panelRef.current && panelRef.current.offsetWidth > availableWidth) {
        next.maxWidth = Math.max(180, availableWidth);
        next.width = Math.min(panelRef.current.offsetWidth, availableWidth);
      }
    } else if (align === 'left') {
      next.left = Math.round(rect.left);
      // Ensure minimum left padding on mobile
      if (isMobile && (next.left as number) < padding) {
        next.left = padding;
      }
      // Constrain width to remain within viewport
      const availableWidth = window.innerWidth - (next.left as number) - padding;
      if (panelRef.current && panelRef.current.offsetWidth > availableWidth) {
        next.maxWidth = Math.max(180, availableWidth);
        next.width = Math.min(panelRef.current.offsetWidth, availableWidth);
      }
    } else {
      let centerX = Math.round(rect.left + rect.width / 2);
      // On mobile, constrain center-aligned dropdowns to viewport
      if (isMobile) {
        const dropdownWidth = panelRef.current?.offsetWidth || 200;
        const leftEdge = centerX - dropdownWidth / 2;
        const rightEdge = centerX + dropdownWidth / 2;
        
        if (leftEdge < padding) {
          centerX = padding + dropdownWidth / 2;
        } else if (rightEdge > window.innerWidth - padding) {
          centerX = window.innerWidth - padding - dropdownWidth / 2;
        }
      }
      next.left = centerX;
    }
    if (minWidth) next.minWidth = typeof minWidth === 'number' ? `${minWidth}px` : String(minWidth);

    // Flip vertically if panel would overflow past viewport bottom
    const wouldOverflowBottom = (typeof next.top === 'number') && (next.top + panelH + padding > window.innerHeight);
    if (wouldOverflowBottom) {
      const upTop = Math.round(rect.top - offset - panelH);
      // Ensure minimum padding from top
      next.top = Math.max(padding, upTop);
    }
    // Universal mobile constraint: clamp max width
    if (isMobile) {
      next.maxWidth = Math.min(window.innerWidth - padding * 2, 400);
      // If panel would overflow to right when left aligned
      if (typeof next.left === 'number') {
        const overflowRight = next.left + (panelRef.current?.offsetWidth || 240) + padding > window.innerWidth;
        if (overflowRight) {
          // Shift left position inside viewport
          const targetWidth = Math.min(panelRef.current?.offsetWidth || 240, window.innerWidth - padding * 2);
          next.left = window.innerWidth - padding - targetWidth;
          next.width = targetWidth;
        }
      }
    }

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
