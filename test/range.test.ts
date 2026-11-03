import { describe, expect, it } from 'vitest';
import { canPickFrom, canPickTo, rangeLabel } from '../src/ui/range';

describe('version popover range', () => {
  const r = { from: 1, to: 3 };

  it('keeps from older than to', () => {
    expect([0, 1, 2, 3, 4].map((row) => canPickFrom(row, r))).toEqual([true, true, true, false, false]);
    expect([0, 1, 2, 3, 4].map((row) => canPickTo(row, r))).toEqual([false, false, true, true, true]);
  });

  it('never allows Base as "to"', () => {
    expect(canPickTo(0, { from: 0, to: 1 })).toBe(false);
  });

  it('labels the trigger', () => {
    expect(rangeLabel({ from: 0, to: 5 }, 5)).toBe('All changes');
    expect(rangeLabel({ from: 0, to: 3 }, 5)).toBe('Base → v3');
    expect(rangeLabel({ from: 2, to: 5 }, 5)).toBe('v2 → v5');
  });
});
