/** Board size: the classic 10×10 sea. */
export const GRID_SIZE = 10;

/**
 * Column letters as used in the classic Russian game (no Ё and Й).
 * Column 0 is «А», column 9 is «К».
 */
export const COLUMN_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'] as const;

/** A cell on the grid. `x` is the column (0..9), `y` is the row (0..9). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

export function inBounds(c: Cell, size = GRID_SIZE): boolean {
  return Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Stable string key for maps and sets, e.g. "3,7". */
export function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

/** Human label such as «Д-4» (column letter, 1-based row). */
export function cellLabel(c: Cell): string {
  const letter = COLUMN_LETTERS[c.x];
  if (letter === undefined || !inBounds(c)) throw new RangeError(`Cell out of bounds: ${cellKey(c)}`);
  return `${letter}-${c.y + 1}`;
}

/** Parses «Д-4», «Д4» or «д 4». Returns null when the text is not a valid cell. */
export function parseCell(label: string): Cell | null {
  const m = /^\s*([А-Яа-я])\s*-?\s*(\d{1,2})\s*$/u.exec(label);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const x = COLUMN_LETTERS.indexOf(m[1].toUpperCase() as (typeof COLUMN_LETTERS)[number]);
  const y = Number(m[2]) - 1;
  const cell = { x, y };
  return x >= 0 && inBounds(cell) ? cell : null;
}

/** The up-to-8 cells touching `c` (including diagonals), clipped to the board. */
export function neighbors8(c: Cell, size = GRID_SIZE): Cell[] {
  const out: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = { x: c.x + dx, y: c.y + dy };
      if (inBounds(n, size)) out.push(n);
    }
  }
  return out;
}
