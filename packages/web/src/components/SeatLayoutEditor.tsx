import { useMemo, useState } from 'react';
import type { GenerateSeatsInput } from '@ticket/shared';
import type { SeatCategoryModel } from '../api/types';
import { Alert, Button, Input, Label, Select } from './ui';

interface SectionDraft {
  categoryId: string;
  rows: string; // comma/space separated row labels, e.g. "A, B"
  seatsPerRow: number;
}

function parseRows(rows: string): string[] {
  return rows
    .split(/[\s,]+/)
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Form for generating a venue's seat grid: a list of sections, each mapping a set
 * of row labels + seats-per-row to a category. Mirrors the API's generator.
 */
export function SeatLayoutEditor({
  categories,
  onGenerate,
  pending,
  disabled,
}: {
  categories: SeatCategoryModel[];
  onGenerate: (input: GenerateSeatsInput) => void;
  pending: boolean;
  disabled?: boolean;
}) {
  const [sections, setSections] = useState<SectionDraft[]>([
    { categoryId: categories[0]?.id ?? '', rows: '', seatsPerRow: 10 },
  ]);
  const [error, setError] = useState<string | null>(null);

  const totalSeats = useMemo(
    () => sections.reduce((sum, s) => sum + parseRows(s.rows).length * (s.seatsPerRow || 0), 0),
    [sections],
  );

  const update = (i: number, patch: Partial<SectionDraft>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSection = () =>
    setSections((prev) => [...prev, { categoryId: categories[0]?.id ?? '', rows: '', seatsPerRow: 10 }]);
  const removeSection = (i: number) => setSections((prev) => prev.filter((_, idx) => idx !== i));

  const submit = () => {
    setError(null);
    const parsed: GenerateSeatsInput['sections'] = [];
    const seen = new Set<string>();
    for (const s of sections) {
      const rowLabels = parseRows(s.rows);
      if (!s.categoryId) return setError('Every section needs a category.');
      if (rowLabels.length === 0) return setError('Every section needs at least one row label.');
      if (s.seatsPerRow < 1) return setError('Seats per row must be at least 1.');
      for (const r of rowLabels) {
        if (seen.has(r)) return setError(`Duplicate row label "${r}".`);
        seen.add(r);
      }
      parsed.push({ categoryId: s.categoryId, rowLabels, seatsPerRow: s.seatsPerRow });
    }
    onGenerate({ sections: parsed });
  };

  if (categories.length === 0) {
    return <Alert tone="info">Add at least one seat category before generating seats.</Alert>;
  }

  return (
    <div className="space-y-4">
      {disabled && (
        <Alert tone="warning">
          A show has already been scheduled here, so the layout is locked.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-3">
        {sections.map((section, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 rounded-xl border border-ink-600 bg-ink-900/40 p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
            <div>
              <Label>Category</Label>
              <Select
                value={section.categoryId}
                onChange={(e) => update(i, { categoryId: e.target.value })}
                disabled={disabled}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Row labels</Label>
              <Input
                placeholder="A, B, C"
                value={section.rows}
                onChange={(e) => update(i, { rows: e.target.value })}
                disabled={disabled}
              />
            </div>
            <div className="w-28">
              <Label>Seats/row</Label>
              <Input
                type="number"
                min={1}
                max={60}
                value={section.seatsPerRow}
                onChange={(e) => update(i, { seatsPerRow: Number(e.target.value) })}
                disabled={disabled}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeSection(i)}
                disabled={disabled || sections.length === 1}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="secondary" size="sm" onClick={addSection} disabled={disabled}>
          + Add section
        </Button>
        <span className="text-sm text-cream-muted">{totalSeats} seats total</span>
      </div>

      <Button type="button" className="w-full" onClick={submit} loading={pending} disabled={disabled}>
        Generate seat layout
      </Button>
    </div>
  );
}
