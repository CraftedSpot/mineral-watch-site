import { createContext, useContext, useCallback, useState, useRef } from 'react';
import { ModalContainer } from '../components/ui/ModalContainer';
import { MAX_MODAL_DEPTH } from '../lib/constants';

export interface ModalEntry {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

interface ModalContextValue {
  stack: ModalEntry[];
  open: (type: string, props?: Record<string, unknown>) => string;
  close: (id?: string) => void;
  closeAll: () => void;
  isOpen: (type: string) => boolean;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const triggerRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const open = useCallback((type: string, props: Record<string, unknown> = {}): string => {
    const id = `modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Save focus trigger for restoration
    triggerRefs.current.set(id, document.activeElement as HTMLElement);

    setStack((prev) => {
      if (prev.length >= MAX_MODAL_DEPTH) {
        console.warn(`[Modal] Max depth ${MAX_MODAL_DEPTH} reached, ignoring open`);
        return prev;
      }
      return [...prev, { id, type, props }];
    });
    return id;
  }, []);

  const close = useCallback((id?: string) => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const target = id ? prev.find((m) => m.id === id) : prev[prev.length - 1];
      if (!target) return prev;

      // Restore focus to trigger element
      const trigger = triggerRefs.current.get(target.id);
      triggerRefs.current.delete(target.id);
      requestAnimationFrame(() => trigger?.focus());

      return prev.filter((m) => m.id !== target.id);
    });
  }, []);

  const closeAll = useCallback(() => {
    setStack([]);
    triggerRefs.current.clear();
  }, []);

  const isOpen = useCallback((type: string) => stack.some((m) => m.type === type), [stack]);

  return (
    <ModalContext.Provider value={{ stack, open, close, closeAll, isOpen }}>
      {children}
      <ModalContainer stack={stack} onClose={close} />
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
