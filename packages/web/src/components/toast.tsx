import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons';

/* ============================================================================
 * Toasts — transient, non-blocking feedback for the outcome of an action.
 * Usage:  const toast = useToast();  toast.success('Seats held for you');
 * ==========================================================================*/

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title?: string;
  message: string;
}

interface ToastOptions {
  title?: string;
  duration?: number;
}

interface ToastApi {
  show: (tone: ToastTone, message: string, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const toneStyles: Record<ToastTone, { bar: string; icon: typeof InfoIcon; text: string }> = {
  success: { bar: 'bg-success', icon: CheckCircleIcon, text: 'text-success' },
  error: { bar: 'bg-rose', icon: AlertIcon, text: 'text-rose-bright' },
  info: { bar: 'bg-info', icon: InfoIcon, text: 'text-info' },
  warning: { bar: 'bg-warning', icon: AlertIcon, text: 'text-warning' },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string, opts?: ToastOptions) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, tone, message, title: opts?.title }]);
      const duration = opts?.duration ?? (tone === 'error' ? 7000 : 4500);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, o) => show('success', m, o),
      error: (m, o) => show('error', m, o),
      info: (m, o) => show('info', m, o),
      warning: (m, o) => show('warning', m, o),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:items-end"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((t) => {
            const s = toneStyles[t.tone];
            const Icon = s.icon;
            return (
              <div
                key={t.id}
                role="status"
                className="pointer-events-auto flex w-full max-w-sm animate-fade-up overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-pop"
              >
                <div className={clsx('w-1 shrink-0', s.bar)} aria-hidden="true" />
                <div className="flex flex-1 items-start gap-3 px-4 py-3">
                  <Icon size={18} className={clsx('mt-0.5 shrink-0', s.text)} />
                  <div className="min-w-0 flex-1 text-sm">
                    {t.title && <p className="font-semibold text-cream">{t.title}</p>}
                    <p className={clsx('text-cream-muted', t.title && 'mt-0.5')}>{t.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="-mr-1 -mt-0.5 shrink-0 rounded-lg p-1 text-cream-dim transition-colors hover:bg-ink-700 hover:text-cream"
                  >
                    <XIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
