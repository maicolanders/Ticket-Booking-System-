import type { SeatCategorySummaryDTO } from '@ticket/shared';
import { formatMoney } from '../lib/format';

/** Category colour key + a colour-independent seat-status legend. */
export function SeatMapLegend({ categories }: { categories: SeatCategorySummaryDTO[] }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-2.5 font-medium text-cream">Categories</p>
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-sm border-2"
                style={{ borderColor: c.color, backgroundColor: `${c.color}33` }}
              />
              <span className="text-cream-muted">{c.name}</span>
              <span className="ml-auto font-medium text-cream">{formatMoney(c.price)}</span>
              <span className="w-16 shrink-0 text-right text-xs text-cream-dim">
                {c.available}/{c.total} left
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2.5 font-medium text-cream">Seat status</p>
        <ul className="grid grid-cols-2 gap-2 text-xs text-cream-muted">
          <li className="flex items-center gap-2">
            <span className="h-4 w-4 shrink-0 rounded-md border-2 border-ink-500 bg-ink-700/50" />
            Available
          </li>
          <li className="flex items-center gap-2">
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-md border-2 border-brass bg-brass" />
            Selected
          </li>
          <li className="flex items-center gap-2">
            <span className="h-4 w-4 shrink-0 rounded-md border-2 border-dashed border-warning/70 bg-ink-700" />
            Held
          </li>
          <li className="flex items-center gap-2">
            <span className="hatch h-4 w-4 shrink-0 rounded-md border-2 border-ink-500 bg-ink-700 opacity-70" />
            Booked
          </li>
        </ul>
      </div>
    </div>
  );
}
