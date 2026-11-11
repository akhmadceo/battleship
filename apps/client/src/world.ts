import { Vector3 } from '@babylonjs/core';
import { type Cell, GRID_SIZE, type ShipPlacement, SHIP_CLASSES } from '@tidebound/shared';

/** World units per grid cell. */
export const CELL = 10;
const SPAN = GRID_SIZE * CELL;

export type Side = 'home' | 'enemy';

/** Air between the two floating islands' pools. */
const GAP = 80;

/**
 * Like the paper game: two boards side by side, ours on the left and the
 * enemy's on the right, each a lagoon on its own floating island. Columns
 * А–К run left to right (+x), rows 1–10 run top to bottom (far to near, -z).
 * `x0, z0` is each board's near-left corner.
 */
export const GRID_ORIGIN: Record<Side, { x0: number; z0: number }> = {
  home: { x0: -GAP / 2 - SPAN, z0: -SPAN / 2 },
  enemy: { x0: GAP / 2, z0: -SPAN / 2 },
};

/** Board size in world units. */
export const BOARD_SPAN = SPAN;

export function cellCenter(side: Side, c: Cell, y = 0): Vector3 {
  const o = GRID_ORIGIN[side];
  return new Vector3(o.x0 + (c.x + 0.5) * CELL, y, o.z0 + SPAN - (c.y + 0.5) * CELL);
}

/** Which board and cell a point on the water falls in, if any. */
export function worldToCell(p: Vector3): { side: Side; cell: Cell } | null {
  for (const side of ['home', 'enemy'] as const) {
    const o = GRID_ORIGIN[side];
    const x = Math.floor((p.x - o.x0) / CELL);
    const y = Math.floor((o.z0 + SPAN - p.z) / CELL);
    if (x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE) return { side, cell: { x, y } };
  }
  return null;
}

/** Centre of a ship on the water, from its placement. */
export function shipCenter(side: Side, p: ShipPlacement): Vector3 {
  const size = SHIP_CLASSES[p.cls].size;
  const first = cellCenter(side, { x: p.x, y: p.y });
  const offset = ((size - 1) * CELL) / 2;
  return p.orientation === 'h' ? first.add(new Vector3(offset, 0, 0)) : first.add(new Vector3(0, 0, -offset));
}

/** Yaw for a ship mesh whose bow points along local +z: across-ships face the enemy island. */
export function shipYaw(p: ShipPlacement): number {
  return p.orientation === 'h' ? Math.PI / 2 : 0;
}

export const GRID_CENTER: Record<Side, Vector3> = {
  home: new Vector3(GRID_ORIGIN.home.x0 + SPAN / 2, 0, 0),
  enemy: new Vector3(GRID_ORIGIN.enemy.x0 + SPAN / 2, 0, 0),
};

/**
 * The lagoon surface height, shared by the water shader (GLSL copy in sea.ts)
 * and by ships bobbing on it. Keep the two in sync.
 */
export function waveHeight(x: number, z: number, t: number): number {
  return (
    0.28 * Math.sin(x * 0.045 + t * 0.9) +
    0.2 * Math.sin(z * 0.06 - t * 1.1) +
    0.12 * Math.sin((x + z) * 0.11 + t * 1.7)
  );
}
