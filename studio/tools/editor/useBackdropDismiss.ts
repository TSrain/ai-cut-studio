import {useRef, type HTMLAttributes} from 'react';

/** Dismiss only a click that both starts and ends on the backdrop. */
export function useBackdropDismiss(onDismiss: () => void, disabled = false): HTMLAttributes<HTMLDivElement> {
  const startedOnBackdrop = useRef(false);
  return {
    onPointerDownCapture(event) {
      startedOnBackdrop.current = event.button === 0 && event.target === event.currentTarget;
    },
    onPointerCancel() { startedOnBackdrop.current = false; },
    onClick(event) {
      const dismiss = startedOnBackdrop.current && event.target === event.currentTarget;
      startedOnBackdrop.current = false;
      if (dismiss && !disabled) { event.stopPropagation(); onDismiss(); }
    },
  };
}
