import type { ShipPlacement } from '../src/index.js';

/** A hand-placed valid classic fleet. */
export const FLEET: ShipPlacement[] = [
  { id: 'iron', cls: 'ironclad', x: 0, y: 0, orientation: 'h' }, // А1–Г1
  { id: 'cor1', cls: 'corvette', x: 5, y: 0, orientation: 'h' },
  { id: 'cor2', cls: 'corvette', x: 0, y: 2, orientation: 'v' },
  { id: 'cut1', cls: 'cutter', x: 2, y: 2, orientation: 'h' },
  { id: 'cut2', cls: 'cutter', x: 5, y: 2, orientation: 'h' },
  { id: 'cut3', cls: 'cutter', x: 8, y: 2, orientation: 'v' },
  { id: 'sk1', cls: 'skiff', x: 2, y: 4, orientation: 'h' },
  { id: 'sk2', cls: 'skiff', x: 4, y: 4, orientation: 'h' },
  { id: 'sk3', cls: 'skiff', x: 6, y: 4, orientation: 'h' },
  { id: 'sk4', cls: 'skiff', x: 9, y: 9, orientation: 'h' },
];
