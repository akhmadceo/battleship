import { type Cell, GRID_SIZE, cellKey, inBounds, neighbors8 } from './grid.js';
import { type FleetError, type ShipClass, type ShipPlacement, SHIP_CLASSES, shipCells, validateFleet } from './fleet.js';

export type TeamId = string;

/** What a team has learned about one cell of the enemy sea. */
export type Mark = 'miss' | 'hit' | 'sunk' | 'empty';

export interface ShipState {
  readonly placement: ShipPlacement;
  /** Cell keys of this ship that have been hit. */
  readonly hits: readonly string[];
  readonly sunk: boolean;
}

export interface TeamState {
  readonly id: TeamId;
  readonly ships: readonly ShipState[];
  /** This team's knowledge of the ENEMY sea, keyed by cellKey. */
  readonly marks: Readonly<Record<string, Mark>>;
}

export interface MatchState {
  readonly round: number;
  readonly teams: readonly [TeamState, TeamState];
  readonly winner: TeamId | 'draw' | null;
}

export interface FireOrder {
  readonly kind: 'fire';
  readonly team: TeamId;
  readonly shipId: string;
  readonly targets: readonly Cell[];
}

/** Movement and abilities arrive in Milestone 1; for now an order is a salvo. */
export type Order = FireOrder;

export type ShotResult = 'miss' | 'hit' | 'sunk' | 'repeat';

export type RejectReason =
  | 'match-over'
  | 'unknown-team'
  | 'unknown-ship'
  | 'ship-sunk'
  | 'duplicate-order'
  | 'too-many-shots'
  | 'no-targets'
  | 'out-of-bounds';

export type MatchEvent =
  | { readonly kind: 'order-rejected'; readonly team: TeamId; readonly shipId: string; readonly reason: RejectReason }
  | {
      readonly kind: 'shot';
      readonly team: TeamId;
      readonly shipId: string;
      readonly target: Cell;
      readonly result: ShotResult;
    }
  | { readonly kind: 'ship-sunk'; readonly owner: TeamId; readonly shipId: string; readonly cells: readonly Cell[] }
  | { readonly kind: 'match-over'; readonly winner: TeamId | 'draw' };

export interface RoundResult {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
}

export class InvalidFleetError extends Error {
  constructor(
    readonly team: TeamId,
    readonly errors: readonly FleetError[],
  ) {
    super(`Invalid fleet for team ${team}: ${errors.map((e) => e.kind).join(', ')}`);
  }
}

export function createMatch(
  teams: readonly [{ id: TeamId; fleet: readonly ShipPlacement[] }, { id: TeamId; fleet: readonly ShipPlacement[] }],
): MatchState {
  if (teams[0].id === teams[1].id) throw new Error('Team ids must differ');
  const build = (t: { id: TeamId; fleet: readonly ShipPlacement[] }): TeamState => {
    const errors = validateFleet(t.fleet);
    if (errors.length > 0) throw new InvalidFleetError(t.id, errors);
    return { id: t.id, ships: t.fleet.map((placement) => ({ placement, hits: [], sunk: false })), marks: {} };
  };
  return { round: 0, teams: [build(teams[0]), build(teams[1])], winner: null };
}

/**
 * Resolves one round. Pure and deterministic: the same state and orders
 * always give the same result, whatever order the orders arrived in.
 *
 * Orders are simultaneous: every ship afloat at the start of the round may
 * fire, even if it is sunk by a shell in the same round.
 */
export function resolveRound(state: MatchState, orders: readonly Order[]): RoundResult {
  const events: MatchEvent[] = [];
  const teamIndex = new Map(state.teams.map((t, i) => [t.id, i] as const));

  // Mutable working copies.
  const ships = state.teams.map((t) => t.ships.map((s) => ({ placement: s.placement, hits: [...s.hits], sunk: s.sunk })));
  const marks = state.teams.map((t) => ({ ...t.marks }));

  const sorted = [...orders].sort((a, b) => (a.team === b.team ? cmp(a.shipId, b.shipId) : cmp(a.team, b.team)));
  const accepted: Order[] = [];
  const seen = new Set<string>();

  for (const o of sorted) {
    const reject = (reason: RejectReason) =>
      events.push({ kind: 'order-rejected', team: o.team, shipId: o.shipId, reason });
    if (state.winner !== null) { reject('match-over'); continue; }
    const ti = teamIndex.get(o.team);
    if (ti === undefined) { reject('unknown-team'); continue; }
    const ship = state.teams[ti]?.ships.find((s) => s.placement.id === o.shipId);
    if (!ship) { reject('unknown-ship'); continue; }
    if (ship.sunk) { reject('ship-sunk'); continue; }
    const key = `${o.team}|${o.shipId}`;
    if (seen.has(key)) { reject('duplicate-order'); continue; }
    if (o.targets.length === 0) { reject('no-targets'); continue; }
    if (o.targets.length > SHIP_CLASSES[ship.placement.cls].shotsPerRound) { reject('too-many-shots'); continue; }
    if (o.targets.some((c) => !inBounds(c))) { reject('out-of-bounds'); continue; }
    seen.add(key);
    accepted.push(o);
  }

  for (const o of accepted) {
    const ti = teamIndex.get(o.team)!;
    const ei = 1 - ti;
    const enemyShips = ships[ei]!;
    const myMarks = marks[ti]!;
    for (const target of o.targets) {
      const k = cellKey(target);
      const victim = enemyShips.find((s) => shipCells(s.placement).some((c) => cellKey(c) === k));
      if (!victim) {
        const already = myMarks[k] !== undefined;
        if (!already) myMarks[k] = 'miss';
        events.push({ kind: 'shot', team: o.team, shipId: o.shipId, target, result: already ? 'repeat' : 'miss' });
        continue;
      }
      if (victim.hits.includes(k)) {
        events.push({ kind: 'shot', team: o.team, shipId: o.shipId, target, result: 'repeat' });
        continue;
      }
      victim.hits.push(k);
      const cells = shipCells(victim.placement);
      if (victim.hits.length < cells.length) {
        myMarks[k] = 'hit';
        events.push({ kind: 'shot', team: o.team, shipId: o.shipId, target, result: 'hit' });
        continue;
      }
      victim.sunk = true;
      for (const c of cells) myMarks[cellKey(c)] = 'sunk';
      // Classic rule: cells around a sunk ship cannot hold a ship, so mark them.
      for (const c of cells) {
        for (const n of neighbors8(c, GRID_SIZE)) {
          const nk = cellKey(n);
          if (myMarks[nk] === undefined) myMarks[nk] = 'empty';
        }
      }
      events.push({ kind: 'shot', team: o.team, shipId: o.shipId, target, result: 'sunk' });
      events.push({ kind: 'ship-sunk', owner: state.teams[ei]!.id, shipId: victim.placement.id, cells });
    }
  }

  const allSunk = ships.map((list) => list.every((s) => s.sunk));
  let winner = state.winner;
  if (winner === null) {
    if (allSunk[0] && allSunk[1]) winner = 'draw';
    else if (allSunk[1]) winner = state.teams[0].id;
    else if (allSunk[0]) winner = state.teams[1].id;
    if (winner !== null) events.push({ kind: 'match-over', winner });
  }

  const team = (i: 0 | 1): TeamState => ({ id: state.teams[i].id, ships: ships[i]!, marks: marks[i]! });
  const teams: [TeamState, TeamState] = [team(0), team(1)];
  return { state: { round: state.round + 1, teams, winner }, events };
}

/** What one team is allowed to see. The server sends only this to clients. */
export interface TeamView {
  readonly round: number;
  readonly winner: TeamId | 'draw' | null;
  readonly team: TeamId;
  readonly ownShips: readonly ShipState[];
  /** Our knowledge of the enemy sea. */
  readonly enemyMarks: Readonly<Record<string, Mark>>;
  /** Enemy ships are revealed only once sunk. */
  readonly enemySunk: readonly ShipPlacement[];
  /** How many enemy ships of each class are still afloat (classic games show this). */
  readonly enemyAfloat: Readonly<Record<ShipClass, number>>;
}

export function viewFor(state: MatchState, team: TeamId): TeamView {
  const ti = state.teams.findIndex((t) => t.id === team);
  if (ti < 0) throw new Error(`Unknown team ${team}`);
  const me = state.teams[ti]!;
  const enemy = state.teams[1 - ti]!;
  const enemyAfloat: Record<ShipClass, number> = { ironclad: 0, corvette: 0, cutter: 0, skiff: 0 };
  for (const s of enemy.ships) if (!s.sunk) enemyAfloat[s.placement.cls]++;
  return {
    round: state.round,
    winner: state.winner,
    team: me.id,
    ownShips: me.ships,
    enemyMarks: me.marks,
    enemySunk: enemy.ships.filter((s) => s.sunk).map((s) => s.placement),
    enemyAfloat,
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
