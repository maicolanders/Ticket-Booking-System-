import { clsx } from 'clsx';
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons';

/* ============================================================================
 * Button
 * ==========================================================================*/

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brass text-ink-950 font-semibold hover:bg-brass-bright shadow-glow-sm',
  secondary: 'border border-ink-500 bg-ink-800 text-cream hover:bg-ink-700 hover:border-ink-500',
  danger: 'bg-rose text-white hover:bg-rose-bright',
  ghost: 'text-cream-muted hover:bg-ink-700 hover:text-cream',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all',
        'active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

/** Icon-only button — requires an accessible `label`. */
export function IconButton({
  label,
  children,
  className,
  variant = 'ghost',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid place-items-center rounded-xl p-2 transition-all active:scale-95 disabled:opacity-40',
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ============================================================================
 * Form fields
 * ==========================================================================*/

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-cream-muted">
      {children}
    </label>
  );
}

const fieldClasses =
  'w-full rounded-xl border border-ink-600 bg-ink-800 px-3.5 py-2.5 text-sm text-cream shadow-sm transition-colors placeholder:text-cream-dim focus:border-brass focus:bg-ink-700 focus:outline-none disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={clsx(fieldClasses, className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={clsx(fieldClasses, className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={clsx(fieldClasses, 'appearance-none', className)} {...props}>
        {children}
      </select>
    );
  },
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-rose-bright">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-cream-dim">{hint}</p>
      )}
    </div>
  );
}

/* ============================================================================
 * Surfaces
 * ==========================================================================*/

export function Card({
  className,
  children,
  interactive,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-ink-600 bg-ink-800 shadow-card',
        interactive && 'transition-all hover:border-ink-500 hover:shadow-pop',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The perforated tear line — the product's signature ticket motif. */
export function TicketPerforation({ className }: { className?: string }) {
  return <div className={clsx('perf-divider my-4', className)} role="presentation" />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx('border-0 border-t border-ink-600', className)} />;
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-cream sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-cream-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* ============================================================================
 * Feedback
 * ==========================================================================*/

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin text-current', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-cream-dim" role="status">
      <Spinner className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

/** Shimmering placeholder block for skeleton screens. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-lg', className)} aria-hidden="true" />;
}

type AlertTone = 'error' | 'success' | 'info' | 'warning';
const alertTones: Record<AlertTone, { cls: string; Icon: typeof InfoIcon }> = {
  error: { cls: 'border-rose-dark/60 bg-rose-dark/15 text-rose-bright', Icon: AlertIcon },
  success: { cls: 'border-success-dark/60 bg-success-dark/20 text-success', Icon: CheckCircleIcon },
  info: { cls: 'border-info-dark/60 bg-info-dark/20 text-info', Icon: InfoIcon },
  warning: { cls: 'border-warning-dark/60 bg-warning-dark/15 text-warning', Icon: AlertIcon },
};

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const { cls, Icon } = alertTones[tone];
  return (
    <div className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls)} role="alert">
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

type BadgeTone = 'neutral' | 'brass' | 'rose' | 'success' | 'warning' | 'info';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-ink-500 bg-ink-700 text-cream-muted',
  brass: 'border-brass/40 bg-brass/15 text-brass-bright',
  rose: 'border-rose/40 bg-rose/15 text-rose-bright',
  success: 'border-success/30 bg-success/15 text-success',
  warning: 'border-warning/30 bg-warning/15 text-warning',
  info: 'border-info/30 bg-info/15 text-info',
};

export function Badge({
  color,
  tone = 'neutral',
  children,
  className,
}: {
  color?: string;
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        badgeTones[tone],
        className,
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-600 bg-ink-800/40 px-6 py-16 text-center">
      {icon && <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-ink-700 text-brass">{icon}</div>}
      <p className="font-display text-lg font-medium text-cream">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-cream-muted">{children}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/* ============================================================================
 * Controls: chips, segmented control, tabs
 * ==========================================================================*/

export function Chip({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-brass bg-brass/15 text-brass-bright'
          : 'border-ink-600 bg-ink-800 text-cream-muted hover:border-ink-500 hover:text-cream',
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex rounded-xl border border-ink-600 bg-ink-800 p-1', className)} role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt.value ? 'bg-brass text-ink-950' : 'text-cream-muted hover:text-cream',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex gap-1 border-b border-ink-600', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            active === t.id
              ? 'border-brass text-cream'
              : 'border-transparent text-cream-dim hover:text-cream-muted',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ============================================================================
 * Modal / Dialog
 * ==========================================================================*/

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const maxW = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'relative w-full rounded-t-2xl border border-ink-600 bg-ink-800 shadow-pop animate-scale-in sm:rounded-2xl',
          maxW,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
            <h2 className="font-display text-lg font-semibold text-cream">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <XIcon size={18} />
            </IconButton>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-ink-600 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
