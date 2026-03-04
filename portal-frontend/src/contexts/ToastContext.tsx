import { createContext, useContext, useCallback, useState, useRef } from 'react';
import { Toast, type ToastType } from '../components/ui/Toast';
import { TOAST_DEFAULT_DURATION } from '../lib/constants';

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);

  const show = useCallback((message: string, type: ToastType, duration = TOAST_DEFAULT_DURATION) => {
    clearTimeout(timerRef.current);
    const id = ++nextId.current;
    setToast({ id, message, type });
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        setToast((prev) => (prev?.id === id ? null : prev));
      }, duration);
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const value: ToastContextValue = {
    success: (msg, dur) => show(msg, 'success', dur),
    error: (msg, dur) => show(msg, 'error', dur),
    warning: (msg, dur) => show(msg, 'warning', dur),
    info: (msg, dur) => show(msg, 'info', dur),
    dismiss,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
