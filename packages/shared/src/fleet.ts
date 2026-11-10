import { type Cell, GRID_SIZE, cellKey, inBounds, neighbors8 } from './grid.js';
import type { Rng } from './rng.js';

export type ShipClass = 'ironclad' | 'corvette' | 'cutter' | 'skiff';

export interface ShipClassSpec {
  readonly size: number;
  /** How many of this class a classic fleet has. */
  readonly count: number;
  /** Shells fired per round when the ship fires. */
  readonly shotsPerRound: number;
  /** Cells the ship may move per round (Manhattan distance). */
  readonly speed: number;
}

/** The classic fleet: 1×4, 2×3, 3×2, 4×1 = 10 ships, 20 cells. */
export const SHIP_CLASSES: Readonly<Record<ShipClass, ShipClassSpec>> = {
  ironclad: { size: 4, count: 1, shotsPerRound: 2, speed: 1 },
  corvette: { size: 3, count: 2, shotsPerRound: 1, speed: 1 },
  cutter: { size: 2, count: 3, shotsPerRound: 1, speed: 2 },
  skiff: { size: 1, count: 4, shotsPerRound: 1, speed: 1 },
};

export const SHIP_CLASS_ORDER: readonly ShipClass[] = ['ironclad', 'corvette', 'cutter', 'skiff'];

export type Orientation = 'h' | 'v';

/** Where a ship sits: its bow cell plus orientation (h = along x, v = along y). */
export interface ShipPlacement {
  readonly id: string;
  readonly cls: ShipClass;
  readonly x: number;
  readonly y: number;
  readonly orientation: Orientation;
}

export function shipCells(p: ShipPlacement): Cell[] {
  const size = SHIP_CLASSES[p.cls].size;
  return Array.from({ length: size }, (_, i) =>
    p.orientation === 'h' ? { x: p.x + i, y: p.y } : { x: p.x, y: p.y + i },
  );
}

export type FleetError =
  | { kind: 'wrong-count'; cls: ShipClass; expected: number; actual: number }
  | { kind: 'duplicate-id'; id: string }
  | { kind: 'out-of-bounds'; id: string }
  | { kind: 'overlap'; id: string; otherId: string }
  | { kind: 'touching'; id: string; otherId: string };

/**
 * Checks a fleet against the classic rules: the right number of each class,
 * every ship on the board, and no two ships overlapping or touching,
 * not even diagonally. Returns an empty array when the fleet is valid.
 */
export function validateFleet(fleet: readonly ShipPlacement[], size = GRID_SIZE): FleetError[] {
  const errors: FleetError[] = [];

  for (const cls of SHIP_CLASS_ORDER) {
    const expected = SHIP_CLASSES[cls].count;
    const actual = fleet.filter((s) => s.cls === cls).length;
    if (actual !== expected) errors.push({ kind: 'wrong-count', cls, expected, actual });
  }

  const seenIds = new Set<string>();
  const occupied = new Map<string, string>(); // cellKey -> ship id
  for (const ship of fleet) {
    if (seenIds.has(ship.id)) errors.push({ kind: 'duplicate-id', id: ship.id });
    seenIds.add(ship.id);

    const cells = shipCells(ship);
    if (cells.some((c) => !inBounds(c, size))) {
      errors.push({ kind: 'out-of-bounds', id: ship.id });
      continue;
    }
    for (const c of cells) {
      const other = occupied.get(cellKey(c));
      if (other !== undefined && other !== ship.id) {
        errors.push({ kind: 'overlap', id: ship.id, otherId: other });
        break;
      }
    }
    for (const c of cells) occupied.set(cellKey(c), ship.id);
  }

  // Touching check (only between ships that do not overlap, to avoid double reports).
  const reported = new Set<string>();
  for (const ship of fleet) {
    for (const c of shipCells(ship)) {
      if (!inBounds(c, size)) continue;
      for (const n of neighbors8(c, size)) {
        const other = occupied.get(cellKey(n));
        if (other === undefined || other === ship.id) continue;
        const pair = [ship.id, other].sort().join('|');
        if (reported.has(pair)) continue;
        reported.add(pair);
        const overlapping = errors.some(
          (e) => e.kind === 'overlap' && [e.id, e.otherId].sort().join('|') === pair,
        );
        if (!overlapping) errors.push({ kind: 'touching', id: ship.id, otherId: other });
      }
    }
  }

  return errors;
}

/**
 * True when `ship` lies fully on the board and neither overlaps nor touches
 * (even diagonally) any of `others`.
 */
export function fitsAmong(ship: ShipPlacement, others: readonly ShipPlacement[], size = GRID_SIZE): boolean {
  const cells = shipCells(ship);
  if (cells.some((c) => !inBounds(c, size))) return false;
  const blocked = new Set<string>();
  for (const o of others) {
    if (o.id === ship.id) continue;
    for (const c of shipCells(o)) {
      blocked.add(cellKey(c));
      for (const n of neighbors8(c, size)) blocked.add(cellKey(n));
    }
  }
  return cells.every((c) => !blocked.has(cellKey(c)));
}

/**
 * Places a full classic fleet at random positions using the given RNG.
 * Used by the AI armada and for quick-start "auto place" in the client.
 */
export function randomFleet(rng: Rng, idPrefix = 's', size = GRID_SIZE): ShipPlacement[] {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const fleet: ShipPlacement[] = [];
    const blocked = new Set<string>();
    let ok = true;
    let n = 0;
    for (const cls of SHIP_CLASS_ORDER) {
      for (let k = 0; k < SHIP_CLASSES[cls].count && ok; k++) {
        ok = false;
        for (let tries = 0; tries < 200; tries++) {
          const placement: ShipPlacement = {
            id: `${idPrefix}${n}`,
            cls,
            x: rng.int(size),
            y: rng.int(size),
            orientation: rng.next() < 0.5 ? 'h' : 'v',
          };
          const cells = shipCells(placement);
          if (cells.some((c) => !inBounds(c, size) || blocked.has(cellKey(c)))) continue;
          for (const c of cells) {
            blocked.add(cellKey(c));
            for (const nb of neighbors8(c, size)) blocked.add(cellKey(nb));
          }
          fleet.push(placement);
          n++;
          ok = true;
          break;
        }
      }
    }
    if (ok) return fleet;
  }
  throw new Error('Could not place a random fleet');
}
