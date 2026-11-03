/**
 * Selection model for the version popover. Rows are 0 = Base, 1..n = v1..vN.
 * "From" can be Base or any version; "to" is always a version; from < to.
 */

export interface Range {
  from: number;
  to: number;
}

export function canPickFrom(row: number, range: Range): boolean {
  return row < range.to;
}

export function canPickTo(row: number, range: Range): boolean {
  return row >= 1 && row > range.from;
}

/** Label for the trigger button. */
export function rangeLabel(range: Range, latest: number): string {
  if (range.from === 0) return range.to === latest ? 'All changes' : `Base → v${range.to}`;
  return `v${range.from} → v${range.to}`;
}
