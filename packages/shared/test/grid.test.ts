import { describe, expect, it } from 'vitest';
import { cellLabel, neighbors8, parseCell } from '../src/index.js';

describe('grid', () => {
  it('labels cells the classic way', () => {
    expect(cellLabel({ x: 0, y: 0 })).toBe('А-1');
    expect(cellLabel({ x: 4, y: 3 })).toBe('Д-4');
    expect(cellLabel({ x: 9, y: 9 })).toBe('К-10');
  });

  it('parses labels with or without a dash and in lower case', () => {
    expect(parseCell('Д-4')).toEqual({ x: 4, y: 3 });
    expect(parseCell('д4')).toEqual({ x: 4, y: 3 });
    expect(parseCell(' К 10 ')).toEqual({ x: 9, y: 9 });
  });

  it('rejects letters outside the board and rows out of range', () => {
    expect(parseCell('Й-1')).toBeNull();
    expect(parseCell('А-11')).toBeNull();
    expect(parseCell('А-0')).toBeNull();
    expect(parseCell('hello')).toBeNull();
  });

  it('round-trips every cell', () => {
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) expect(parseCell(cellLabel({ x, y }))).toEqual({ x, y });
  });

  it('clips neighbours at the corner', () => {
    expect(neighbors8({ x: 0, y: 0 })).toHaveLength(3);
    expect(neighbors8({ x: 5, y: 5 })).toHaveLength(8);
  });
});
