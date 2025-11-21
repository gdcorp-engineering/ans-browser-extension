import { useEffect, useState } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  isExiting?: boolean;
}

interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration || 3000);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const icon = {
    success: '✓',
    error: '✕',
    info: 'ⓘ',
    warning: '⚠',
  }[toast.type];

  const ariaLabel = {
    success: 'Success notification',
    error: 'Error notification',
    info: 'Information notification',
    warning: 'Warning notification',
  }[toast.type];

  return (
    <div
      className={`toast toast-${toast.type}${toast.isExiting ? ' toast-exiting' : ''}`}
      onClick={() => onDismiss(toast.id)}
      role="alert"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-label={ariaLabel}
    >
      <span className="toast-icon" aria-hidden="true">{icon}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const MAX_TOASTS = 5;

  const showToast = (message: string, type: ToastType = 'info', duration?: number) => {
    const id = crypto.randomUUID();
    setToasts((prev) => {
      // Remove oldest toast if at max capacity
      const newToasts = prev.length >= MAX_TOASTS ? prev.slice(1) : prev;
      return [...newToasts, { id, message, type, duration, isExiting: false }];
    });
  };

  const dismissToast = (id: string) => {
    // Mark as exiting first for animation
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t))
    );

    // Remove after animation completes
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200); // Match animation duration
  };

  // Add keyboard support (Escape to dismiss all)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && toasts.length > 0) {
        // Dismiss the most recent toast
        dismissToast(toasts[toasts.length - 1].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toasts]);

  return {
    toasts,
    showToast,
    dismissToast,
    success: (message: string, duration?: number) => showToast(message, 'success', duration),
    error: (message: string, duration?: number) => showToast(message, 'error', duration),
    info: (message: string, duration?: number) => showToast(message, 'info', duration),
    warning: (message: string, duration?: number) => showToast(message, 'warning', duration),
  };
}
