import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { SeatStatus, type SeatMapDTO, type SeatMapSeatDTO } from '@ticket/shared';
import { IconButton } from './ui';
import { ZoomInIcon, ZoomOutIcon } from './icons';

interface SeatMapProps {
  seatMap: SeatMapDTO;
  selectedIds: Set<string>;
  onToggle: (seat: SeatMapSeatDTO) => void;
  disabled?: boolean;
  /** Label for the focal element — "Screen" for movies, "Stage" for concerts. */
  screenLabel?: string;
}

type SeatState = 'available' | 'selected' | 'mine' | 'held' | 'booked';

function seatStateOf(seat: SeatMapSeatDTO, selected: boolean): SeatState {
  if (selected) return 'selected';
  if (seat.heldByMe) return 'mine';
  if (seat.status === SeatStatus.BOOKED) return 'booked';
  if (seat.status === SeatStatus.HELD) return 'held';
  return 'available';
}

// Each state carries a *non-colour* cue (fill vs. outline vs. dashed vs. hatch)
// so seats remain distinguishable without relying on colour alone.
const stateClasses: Record<SeatState, string> = {
  available: 'border-2 bg-ink-700/50 text-cream hover:bg-ink-600 hover:-translate-y-0.5',
  selected: 'border-2 border-brass bg-brass text-ink-950 font-semibold shadow-glow-sm animate-seat-pop',
  mine: 'border-2 border-brass bg-brass/30 text-brass-bright',
  held: 'border-2 border-dashed border-warning/70 bg-ink-700 text-cream-dim cursor-not-allowed',
  booked: 'hatch border-2 border-ink-500 bg-ink-700 text-cream-dim line-through cursor-not-allowed opacity-70',
};

const stateWord: Record<SeatState, string> = {
  available: 'available',
  selected: 'selected',
  mine: 'held by you',
  held: 'held by another guest',
  booked: 'booked',
};

function groupRows(seats: SeatMapSeatDTO[]): SeatMapSeatDTO[][] {
  const byRow = new Map<number, SeatMapSeatDTO[]>();
  for (const seat of seats) {
    const row = byRow.get(seat.gridRow) ?? [];
    row.push(seat);
    byRow.set(seat.gridRow, row);
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => a.gridCol - b.gridCol));
}

const BASE = 30;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.8;

export function SeatMap({ seatMap, selectedIds, onToggle, disabled, screenLabel = 'Screen' }: SeatMapProps) {
  const rows = useMemo(() => groupRows(seatMap.seats), [seatMap.seats]);
  const [zoom, setZoom] = useState(1);

  const seatSize = Math.round(BASE * zoom);
  const gap = Math.max(3, Math.round(6 * zoom));
  const fontSize = Math.max(9, Math.round(11 * zoom));
  const labelWidth = Math.round(18 * zoom);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-cream-dim">Tap a seat to select · pinch or use +/− to zoom</p>
        <div className="flex items-center gap-1">
          <IconButton
            label="Zoom out"
            variant="secondary"
            disabled={zoom <= ZOOM_MIN}
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.2).toFixed(1)))}
          >
            <ZoomOutIcon size={16} />
          </IconButton>
          <span className="w-10 text-center font-mono text-xs text-cream-dim">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label="Zoom in"
            variant="secondary"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.2).toFixed(1)))}
          >
            <ZoomInIcon size={16} />
          </IconButton>
        </div>
      </div>

      <div className="thin-scroll overflow-auto rounded-2xl bg-ink-900/50 p-4">
        <div className="mx-auto w-fit">
          {/* Screen / stage */}
          <div className="mx-auto mb-6" style={{ maxWidth: 460 }}>
            <div
              className="mx-auto h-2 rounded-t-[100%] bg-gradient-to-b from-brass/70 to-transparent shadow-[0_0_30px_2px_rgba(224,164,74,0.35)]"
              style={{ width: '80%' }}
            />
            <p className="mt-2 text-center text-[11px] font-medium uppercase tracking-[0.35em] text-cream-dim">
              {screenLabel}
            </p>
          </div>

          <div className="flex flex-col items-center" style={{ gap }}>
            {rows.map((row) => (
              <div key={row[0].gridRow} className="flex items-center" style={{ gap }}>
                <span
                  className="shrink-0 text-right font-mono text-cream-dim"
                  style={{ width: labelWidth, fontSize }}
                >
                  {row[0].rowLabel}
                </span>
                <div className="flex" style={{ gap }}>
                  {row.map((seat) => {
                    const selected = selectedIds.has(seat.id);
                    const state = seatStateOf(seat, selected);
                    const clickable = !disabled && (state === 'available' || state === 'selected');
                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={!clickable}
                        aria-pressed={selected}
                        aria-label={`Seat ${seat.rowLabel}${seat.colNumber}, ${seat.categoryName}, ${stateWord[state]}`}
                        onClick={() => onToggle(seat)}
                        style={{
                          width: seatSize,
                          height: seatSize,
                          fontSize,
                          ...(state === 'available' ? { borderColor: seat.categoryColor } : {}),
                        }}
                        className={clsx(
                          'grid shrink-0 place-items-center rounded-md transition-all',
                          stateClasses[state],
                        )}
                      >
                        {seat.colNumber}
                      </button>
                    );
                  })}
                </div>
                <span
                  className="shrink-0 font-mono text-cream-dim"
                  style={{ width: labelWidth, fontSize }}
                >
                  {row[0].rowLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
