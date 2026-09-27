import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Toast } from '../game/reducer';

interface ToastsProps {
  toasts: readonly Toast[];
  onDismiss: (id: number) => void;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return <div className={`toast toast--${toast.tone}`}>{toast.message}</div>;
}

/**
 * Short messages above the board, in a polite live region. Portalled to <body>
 * so they also show (and are announced) above an open modal.
 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}
