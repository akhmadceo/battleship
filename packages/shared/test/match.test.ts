import { describe, expect, it } from 'vitest';
import {
  InvalidFleetError,
  createMatch,
  createRng,
  randomFleet,
  resolveRound,
  shipCells,
  viewFor,
  type FireOrder,
  type MatchState,
} from '../src/index.js';
import { FLEET } from './fixtures.js';

const fire = (team: string, shipId: string, ...targets: [number, number][]): FireOrder => ({
  kind: 'fire',
  team,
  shipId,
  targets: targets.map(([x, y]) => ({ x, y })),
});

const newMatch = (): MatchState =>
  createMatch([
    { id: 'blue', fleet: FLEET },
    { id: 'red', fleet: FLEET },
  ]);

describe('createMatch', () => {
  it('refuses an invalid fleet', () => {
    expect(() => createMatch([{ id: 'blue', fleet: FLEET.slice(1) }, { id: 'red', fleet: FLEET }])).toThrow(InvalidFleetError);
  });
});

describe('resolveRound', () => {
  it('reports a miss and marks it', () => {
    const { state, events } = resolveRound(newMatch(), [fire('blue', 'sk1', [9, 0])]);
    expect(events).toEqual([{ kind: 'shot', team: 'blue', shipId: 'sk1', target: { x: 9, y: 0 }, result: 'miss' }]);
    expect(state.teams[0].marks['9,0']).toBe('miss');
    expect(state.round).toBe(1);
  });

  it('reports a hit (ранил), then sunk (убил) with the ring auto-marked empty', () => {
    let s = newMatch();
    let r = resolveRound(s, [fire('blue', 'iron', [5, 2])]);
    expect(r.events[0]).toMatchObject({ result: 'hit' });
    s = r.state;
    r = resolveRound(s, [fire('blue', 'iron', [6, 2])]);
    expect(r.events.map((e) => e.kind)).toEqual(['shot', 'ship-sunk']);
    expect(r.events[0]).toMatchObject({ result: 'sunk' });
    const marks = r.state.teams[0].marks;
    expect(marks['5,2']).toBe('sunk');
    expect(marks['6,2']).toBe('sunk');
    expect(marks['4,1']).toBe('empty');
    expect(marks['7,3']).toBe('empty');
  });

  it('lets the ironclad fire two shells but refuses a third', () => {
    const ok = resolveRound(newMatch(), [fire('blue', 'iron', [9, 0], [9, 1])]);
    expect(ok.events.filter((e) => e.kind === 'shot')).toHaveLength(2);
    const bad = resolveRound(newMatch(), [fire('blue', 'iron', [9, 0], [9, 1], [9, 2])]);
    expect(bad.events).toEqual([{ kind: 'order-rejected', team: 'blue', shipId: 'iron', reason: 'too-many-shots' }]);
  });

  it('rejects bad orders without changing the board', () => {
    const s = newMatch();
    const r = resolveRound(s, [
      fire('green', 'sk1', [0, 0]),
      fire('blue', 'nope', [0, 0]),
      fire('blue', 'sk1', [10, 0]),
      fire('blue', 'sk2'),
    ]);
    expect(r.events.map((e) => (e.kind === 'order-rejected' ? e.reason : e.kind)).sort()).toEqual(
      ['no-targets', 'out-of-bounds', 'unknown-ship', 'unknown-team'].sort(),
    );
    expect(r.state.teams[0].marks).toEqual({});
  });

  it('accepts only one order per ship per round', () => {
    const r = resolveRound(newMatch(), [fire('blue', 'sk1', [9, 0]), fire('blue', 'sk1', [9, 1])]);
    expect(r.events.filter((e) => e.kind === 'order-rejected')).toHaveLength(1);
  });

  it('marks a repeat shot without counting it twice', () => {
    const first = resolveRound(newMatch(), [fire('blue', 'sk1', [0, 0])]);
    const second = resolveRound(first.state, [fire('blue', 'sk1', [0, 0])]);
    expect(second.events[0]).toMatchObject({ result: 'repeat' });
    expect(second.state.teams[1].ships.find((s) => s.placement.id === 'iron')!.hits).toEqual(['0,0']);
  });

  it('is simultaneous: a ship sunk this round still fires', () => {
    const r = resolveRound(newMatch(), [fire('blue', 'sk1', [2, 4]), fire('red', 'sk1', [9, 9])]);
    const shots = r.events.filter((e) => e.kind === 'shot');
    expect(shots).toHaveLength(2);
    expect(shots.every((e) => e.kind === 'shot' && e.result === 'sunk')).toBe(true);
  });

  it('does not depend on the order orders arrived in', () => {
    const orders = [fire('red', 'cor1', [1, 1]), fire('blue', 'iron', [0, 0], [3, 3]), fire('blue', 'sk1', [5, 0])];
    expect(resolveRound(newMatch(), orders)).toEqual(resolveRound(newMatch(), [...orders].reverse()));
  });

  it('does not mutate the input state', () => {
    const s = newMatch();
    const before = JSON.stringify(s);
    resolveRound(s, [fire('blue', 'iron', [0, 0], [1, 0])]);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('ends the match when a whole fleet is sunk, then refuses more orders', () => {
    let s = newMatch();
    const targets = FLEET.flatMap((p) => shipCells(p));
    for (const t of targets) s = resolveRound(s, [fire('blue', 'sk1', [t.x, t.y])]).state;
    expect(s.winner).toBe('blue');
    const after = resolveRound(s, [fire('red', 'sk1', [0, 0])]);
    expect(after.events).toEqual([{ kind: 'order-rejected', team: 'red', shipId: 'sk1', reason: 'match-over' }]);
  });

  it('declares a draw when both fleets go down in the same round', () => {
    // Both teams have the same fleet and fire at the same cells each round,
    // always with their first ship still afloat.
    let s = newMatch();
    const shooter = (team: 0 | 1) => s.teams[team].ships.find((x) => !x.sunk)!.placement.id;
    for (const t of FLEET.flatMap((p) => shipCells(p))) {
      expect(s.winner).toBeNull();
      s = resolveRound(s, [fire('blue', shooter(0), [t.x, t.y]), fire('red', shooter(1), [t.x, t.y])]).state;
    }
    expect(s.winner).toBe('draw');
  });
});

describe('viewFor', () => {
  it('never reveals enemy ships that are still afloat', () => {
    const red = randomFleet(createRng(7), 'r');
    const s = createMatch([
      { id: 'blue', fleet: FLEET },
      { id: 'red', fleet: red },
    ]);
    const view = viewFor(s, 'blue');
    const json = JSON.stringify(view);
    for (const p of red) expect(json).not.toContain(`"${p.id}"`);
    expect(view.enemySunk).toEqual([]);
    expect(view.enemyAfloat).toEqual({ ironclad: 1, corvette: 2, cutter: 3, skiff: 4 });
  });

  it('reveals an enemy ship once it is sunk', () => {
    const r = resolveRound(newMatch(), [fire('blue', 'sk1', [9, 9])]);
    const view = viewFor(r.state, 'blue');
    expect(view.enemySunk.map((p) => p.id)).toEqual(['sk4']);
    expect(view.enemyAfloat.skiff).toBe(3);
  });
});
