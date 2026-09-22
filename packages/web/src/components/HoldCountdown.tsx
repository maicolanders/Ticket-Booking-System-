import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { formatCountdown } from '../lib/format';

/**
 * Live mm:ss countdown to `expiresAt`. Fires `onExpire` once when it reaches 0.
 */
export function HoldCountdown({
  expiresAt,
  onExpire,
  className,
}: {
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
}) {
  const secondsLeft = () => Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
  const [remaining, setRemaining] = useState(secondsLeft);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    let fired = false;
    const tick = () => {
      const r = Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
      setRemaining(r);
      if (r <= 0 && !fired) {
        fired = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const danger = remaining <= 60;
  return (
    <span
      className={clsx(
        'font-mono font-semibold tabular-nums',
        danger ? 'text-rose-bright' : 'text-brass-bright',
        className,
      )}
    >
      {formatCountdown(remaining)}
    </span>
  );
}
