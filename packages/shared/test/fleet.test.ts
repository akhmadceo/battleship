import { describe, expect, it } from 'vitest';
import { createRng, randomFleet, validateFleet, type ShipPlacement } from '../src/index.js';
import { FLEET } from './fixtures.js';

const replace = (id: string, patch: Partial<ShipPlacement>): ShipPlacement[] =>
  FLEET.map((s) => (s.id === id ? { ...s, ...patch } : s));

describe('validateFleet', () => {
  it('accepts a valid classic fleet', () => {
    expect(validateFleet(FLEET)).toEqual([]);
  });

  it('rejects a missing ship', () => {
    expect(validateFleet(FLEET.slice(0, -1))).toContainEqual({ kind: 'wrong-count', cls: 'skiff', expected: 4, actual: 3 });
  });

  it('rejects a ship off the board', () => {
    expect(validateFleet(replace('iron', { x: 8 }))).toContainEqual({ kind: 'out-of-bounds', id: 'iron' });
  });

  it('rejects overlapping ships', () => {
    const errors = validateFleet(replace('sk4', { x: 0, y: 0 }));
    expect(errors.some((e) => e.kind === 'overlap')).toBe(true);
  });

  it('rejects ships touching diagonally', () => {
    const errors = validateFleet(replace('sk4', { x: 4, y: 1 })); // touches Г1 of the ironclad diagonally
    expect(errors).toContainEqual({ kind: 'touching', id: 'iron', otherId: 'sk4' });
  });

  it('rejects duplicate ids', () => {
    expect(validateFleet(replace('sk4', { id: 'sk3' }))).toContainEqual({ kind: 'duplicate-id', id: 'sk3' });
  });
});

describe('randomFleet', () => {
  it('always produces a valid fleet', () => {
    for (let seed = 1; seed <= 200; seed++) expect(validateFleet(randomFleet(createRng(seed)))).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    expect(randomFleet(createRng(42))).toEqual(randomFleet(createRng(42)));
  });
});
