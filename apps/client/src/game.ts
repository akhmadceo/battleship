import {
  type Engine,
  Matrix,
  type Mesh,
  MeshBuilder,
  PointerEventTypes,
  type Scene,
  type TransformNode,
  Vector3,
} from '@babylonjs/core';
import {
  type Cell,
  type MatchEvent,
  type MatchState,
  type Order,
  type ShipPlacement,
  SHIP_CLASSES,
  cellKey,
  cellLabel,
  createMatch,
  createRng,
  eventsFor,
  fitsAmong,
  randomFleet,
  resolveRound,
  shipCells,
  viewFor,
} from '@tidebound/shared';
import { Sfx } from './audio';
import { CameraRig } from './camera';
import { Fx } from './fx';
import { Hud } from './hud';
import { mat } from './palette';
import { type Rendering, setupRendering } from './render';
import { createSea, type Sea } from './sea';
import { CLASS_NAMES, buildShip, foamRing, ghostOf } from './ships';
import { CELL, cellCenter, shipCenter, shipYaw, waveHeight, worldToCell } from './world';

const PLAN_SECONDS = 20;
const ME = 'blue';
const ENEMY = 'red';

interface Plan {
  targets: Cell[];
  move: { dx: number; dy: number } | null;
}

interface ShipVisual {
  node: TransformNode;
  ghost: TransformNode;
  /** Where the ship sits on the water before bobbing. */
  pos: Vector3;
  yaw: number;
  /** Extra tilt and sink for wrecks. */
  sink: number;
  tilt: number;
  foam: Mesh | null;
}

interface Timer {
  at: number;
  fn: () => void;
}

interface Disposable {
  dispose(): void;
}

/** The offline vertical slice: our fleet against a hidden, static enemy fleet. */
export class Game {
  readonly rig: CameraRig;
  private readonly sea: Sea;
  private readonly fx: Fx;
  private readonly hud: Hud;
  private readonly rendering: Rendering;
  private readonly sfx = new Sfx();

  private state!: MatchState;
  private phase: 'plan' | 'resolve' | 'over' = 'plan';
  private planLeft = PLAN_SECONDS;
  private plans = new Map<string, Plan>();
  private active = '';
  private time = 0;
  private timers: Timer[] = [];
  private animations: ((dt: number) => boolean)[] = [];

  private ships = new Map<string, ShipVisual>();
  private wrecks: ShipVisual[] = [];
  private marks: Disposable[] = [];
  private targetMarkers: Mesh[] = [];
  private readonly hover: Mesh;
  private readonly pointer: Mesh;
  private hoverCell: Cell | null = null;
  private followShell: Mesh | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly scene: Scene,
    overlay: HTMLElement,
    private readonly seed: number,
  ) {
    this.rig = new CameraRig(scene);
    this.sea = createSea(scene);
    const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
    this.rendering = setupRendering(scene, this.rig.camera, lowPower);
    this.fx = new Fx(scene);
    this.hud = new Hud(overlay, {
      ready: () => this.ready(),
      nextShip: () => this.cycleShip(),
      toggleMap: () => this.rig.setMode('overview'),
      toggleShip: () => this.rig.toggle('chase'),
      toggleAim: () => this.rig.toggle('aim'),
      toggleSound: () => this.hud.setMuted(this.sfx.toggleMute()),
      move: (dx, dy) => this.planMove(dx, dy),
      restart: () => this.start(this.seed + 1 + Math.floor(Math.random() * 1000)),
    });

    this.hover = this.square('hover', 0.35);
    this.pointer = MeshBuilder.CreateCylinder('pointer', { diameterTop: 3, diameterBottom: 0, height: 3.5, tessellation: 4 }, scene);
    this.pointer.material = mat(scene, 'move', { emissive: 0.7 });
    this.pointer.isPickable = false;

    this.hud.setMuted(this.sfx.muted);
    this.bindInput();
    this.start(seed);
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(engine.getDeltaTime() / 1000, 0.1)));
  }

  // ---------------------------------------------------------------- setup

  start(seed: number): void {
    for (const v of [...this.ships.values(), ...this.wrecks]) {
      v.node.dispose();
      v.ghost.dispose();
      v.foam?.dispose();
    }
    this.ships.clear();
    this.wrecks = [];
    this.clearMarks();
    this.timers = [];
    this.animations = [];
    this.hud.clearLog();
    this.hud.banner(null);

    const rng = createRng(seed);
    this.state = createMatch([
      { id: ME, fleet: randomFleet(rng, 'b') },
      { id: ENEMY, fleet: randomFleet(rng, 'r') },
    ]);
    for (const s of this.state.teams[0].ships) {
      const node = buildShip(this.scene, s.placement.cls, 'blue', s.placement.id);
      const v: ShipVisual = {
        node,
        ghost: ghostOf(this.scene, node, `${s.placement.id}-ghost`),
        pos: shipCenter('home', s.placement),
        yaw: shipYaw(s.placement),
        sink: 0,
        tilt: 0,
        foam: foamRing(this.scene, s.placement.cls, `${s.placement.id}-foam`),
      };
      for (const m of node.getChildMeshes()) this.rendering.shadows.addShadowCaster(m);
      this.ships.set(s.placement.id, v);
    }
    this.active = this.order()[0] ?? '';
    this.rebuildMarks();
    this.hud.log('The enemy fleet hides in the lagoon on the right. Find it!', 'info');
    this.beginPlan();
  }

  private square(key: 'hover' | 'target', alpha: number): Mesh {
    const m = MeshBuilder.CreateGround(`sq-${key}`, { width: CELL * 0.86, height: CELL * 0.86 }, this.scene);
    m.material = mat(this.scene, key, { emissive: 0.8, alpha });
    m.isPickable = false;
    m.setEnabled(false);
    return m;
  }

  // ---------------------------------------------------------------- helpers

  private myShip(id: string) {
    return this.state.teams[0].ships.find((s) => s.placement.id === id);
  }

  /** Our ships afloat, biggest first: the Tab order. */
  private order(): string[] {
    return this.state.teams[0].ships
      .filter((s) => !s.sunk)
      .sort((a, b) => SHIP_CLASSES[b.placement.cls].size - SHIP_CLASSES[a.placement.cls].size || (a.placement.id < b.placement.id ? -1 : 1))
      .map((s) => s.placement.id);
  }

  private plan(id: string): Plan {
    let p = this.plans.get(id);
    if (!p) {
      p = { targets: [], move: null };
      this.plans.set(id, p);
    }
    return p;
  }

  private planned(p: ShipPlacement): ShipPlacement {
    const m = this.plans.get(p.id)?.move;
    return m ? { ...p, x: p.x + m.dx, y: p.y + m.dy } : p;
  }

  private totalShots(): { planned: number; available: number } {
    let planned = 0;
    let available = 0;
    for (const id of this.order()) {
      available += SHIP_CLASSES[this.myShip(id)!.placement.cls].shotsPerRound;
      planned += this.plans.get(id)?.targets.length ?? 0;
    }
    return { planned, available };
  }

  // ---------------------------------------------------------------- planning

  private beginPlan(): void {
    this.phase = 'plan';
    this.planLeft = PLAN_SECONDS;
    this.plans.clear();
    if (!this.myShip(this.active) || this.myShip(this.active)!.sunk) this.active = this.order()[0] ?? '';
    this.refreshTargets();
    if (this.state.round > 0) this.sfx.roundStart();
  }

  cycleShip(): void {
    const ids = this.order();
    if (ids.length === 0) return;
    this.active = ids[(ids.indexOf(this.active) + 1) % ids.length]!;
    this.sfx.click();
  }

  /** Stereo position for a world x: our island on the left, theirs on the right. */
  private pan(x: number): number {
    return x / 160;
  }

  /** Toggle a target on an enemy cell, giving it to the active ship or the next ship with a free shell. */
  aimAt(cell: Cell): void {
    if (this.phase !== 'plan') return;
    const key = cellKey(cell);
    for (const [, p] of this.plans) {
      const i = p.targets.findIndex((c) => cellKey(c) === key);
      if (i >= 0) {
        p.targets.splice(i, 1);
        this.refreshTargets();
        this.sfx.aim(this.pan(cellCenter('enemy', cell).x), false);
        return;
      }
    }
    const ids = this.order();
    const start = Math.max(0, ids.indexOf(this.active));
    for (let k = 0; k < ids.length; k++) {
      const id = ids[(start + k) % ids.length]!;
      const ship = this.myShip(id)!;
      const p = this.plan(id);
      if (p.targets.length < SHIP_CLASSES[ship.placement.cls].shotsPerRound) {
        p.targets.push(cell);
        this.refreshTargets();
        this.sfx.aim(this.pan(cellCenter('enemy', cell).x), true);
        return;
      }
    }
    this.sfx.denied();
    this.hud.log('Every ship already has a target. Press Fire!', 'info');
  }

  planMove(dx: number, dy: number): void {
    if (this.phase !== 'plan' || !this.active) return;
    const ship = this.myShip(this.active)!;
    const p = this.plan(this.active);
    const nx = (p.move?.dx ?? 0) + dx;
    const ny = (p.move?.dy ?? 0) + dy;
    if (nx === 0 && ny === 0) {
      p.move = null;
      return;
    }
    if (Math.abs(nx) + Math.abs(ny) > SHIP_CLASSES[ship.placement.cls].speed) {
      this.sfx.denied();
      this.hud.log(`${CLASS_NAMES[ship.placement.cls]} can't sail that far in one round`, 'info');
      return;
    }
    const moved = { ...ship.placement, x: ship.placement.x + nx, y: ship.placement.y + ny };
    const others = this.state.teams[0].ships.filter((s) => s.placement.id !== ship.placement.id).map((s) => this.planned(s.placement));
    if (!fitsAmong(moved, others)) {
      this.sfx.denied();
      this.hud.log('Blocked: ships may not leave the lagoon or touch each other', 'info');
      return;
    }
    p.move = { dx: nx, dy: ny };
    this.sfx.move(this.pan(shipCenter('home', moved).x));
  }

  ready(): void {
    if (this.phase !== 'plan') return;
    document.querySelector('.help')?.remove();
    this.resolve();
  }

  private refreshTargets(): void {
    for (const m of this.targetMarkers) m.dispose();
    this.targetMarkers = [];
    for (const [, p] of this.plans) {
      for (const c of p.targets) {
        const sq = this.square('target', 0.5);
        sq.setEnabled(true);
        sq.position = cellCenter('enemy', c, 1.3);
        this.targetMarkers.push(sq);
      }
    }
  }

  // ---------------------------------------------------------------- resolving

  private after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  private resolve(): void {
    this.phase = 'resolve';
    for (const v of this.ships.values()) v.ghost.setEnabled(false);
    const orders: Order[] = [];
    for (const [shipId, p] of this.plans) {
      if (p.move) orders.push({ kind: 'move', team: ME, shipId, dx: p.move.dx, dy: p.move.dy });
      if (p.targets.length) orders.push({ kind: 'fire', team: ME, shipId, targets: [...p.targets] });
    }
    for (const m of this.targetMarkers) m.dispose();
    this.targetMarkers = [];

    const result = resolveRound(this.state, orders);
    const events = eventsFor(result.events, ME);
    const next = result.state;

    // 1. Ships sail.
    let t = 0;
    const moved = events.filter((e): e is Extract<MatchEvent, { kind: 'ship-moved' }> => e.kind === 'ship-moved');
    for (const e of moved) {
      const v = this.ships.get(e.shipId)!;
      const placement = next.teams[0].ships.find((s) => s.placement.id === e.shipId)!.placement;
      this.tween(v.pos.clone(), shipCenter('home', placement), 0.9, (p) => v.pos.copyFrom(p));
    }
    if (moved.length) t += 1;
    for (const e of events) if (e.kind === 'order-rejected') this.hud.log(`Order refused: ${e.reason}`, 'info');

    // 2. Shells fly, one after another.
    const shots = events.filter((e): e is Extract<MatchEvent, { kind: 'shot' }> => e.kind === 'shot');
    const sunk = events.filter((e): e is Extract<MatchEvent, { kind: 'ship-sunk' }> => e.kind === 'ship-sunk');
    let landed = 0;
    shots.forEach((e, i) => {
      this.after(t + i * 0.35, () => {
        const v = this.ships.get(e.shipId)!;
        const from = v.pos.add(new Vector3(0, 4, 0));
        const to = cellCenter('enemy', e.target, 0.5);
        this.fx.muzzle(from);
        this.sfx.cannon(this.pan(from.x));
        this.sfx.whistle(1.4, 0.3);
        this.followShell = this.fx.shell(from, to, 1.4, () => {
          landed++;
          this.impact(e, sunk);
        });
      });
    });

    // 3. Wrap up once every shell has landed.
    const wrapUp = () => {
      if (landed < shots.length) {
        this.after(0.2, wrapUp);
        return;
      }
      this.followShell = null;
      this.rig.focus = null;
      this.state = next;
      this.rebuildMarks();
      if (next.winner) {
        this.phase = 'over';
        this.hud.banner(next.winner === ME ? 'Victory!' : 'Defeat', `Enemy fleet sunk in ${next.round} rounds.`);
        this.sfx.fanfare(next.winner === ME);
        return;
      }
      this.beginPlan();
    };
    this.after(t + Math.max(0, shots.length - 1) * 0.35 + 1.4 + 1.0, wrapUp);
    if (shots.length === 0) this.hud.log('No shells fired this round', 'info');
  }

  private impact(e: Extract<MatchEvent, { kind: 'shot' }>, sunk: Extract<MatchEvent, { kind: 'ship-sunk' }>[]): void {
    const at = cellCenter('enemy', e.target, 0.5);
    const label = cellLabel(e.target);
    const from = CLASS_NAMES[this.myShip(e.shipId)!.placement.cls];
    const pan = this.pan(at.x);
    if (e.result === 'miss' || e.result === 'repeat') this.sfx.splash(pan);
    else this.sfx.explosion(e.result === 'sunk', pan);
    if (e.result === 'sunk') this.sfx.sink(pan);
    switch (e.result) {
      case 'miss':
        this.fx.splash(at);
        this.hud.log(`${label}: мимо (miss) · ${from}`, 'miss');
        break;
      case 'repeat':
        this.fx.splash(at);
        this.hud.log(`${label}: already hit`, 'miss');
        break;
      case 'hit':
        this.fx.explosion(at, false);
        this.hud.log(`${label}: ранил (hit!) · ${from}`, 'hit');
        break;
      case 'sunk': {
        this.fx.explosion(at, true);
        const s = sunk.find((x) => x.cells.some((c) => c.x === e.target.x && c.y === e.target.y));
        const enemyShip = s && this.state.teams[1].ships.find((x) => x.placement.id === s.shipId);
        if (enemyShip) {
          this.revealWreck(enemyShip.placement);
          this.hud.log(`${label}: убил! ${CLASS_NAMES[enemyShip.placement.cls]} sunk`, 'sunk');
        }
        break;
      }
    }
  }

  private revealWreck(p: ShipPlacement): void {
    const node = buildShip(this.scene, p.cls, 'red', `wreck-${p.id}`);
    const v: ShipVisual = { node, ghost: node, pos: shipCenter('enemy', p), yaw: shipYaw(p), sink: 0, tilt: 0, foam: null };
    for (const m of node.getChildMeshes()) this.rendering.shadows.addShadowCaster(m);
    this.wrecks.push(v);
    let t = 0;
    this.animations.push((dt) => {
      t += dt;
      const k = Math.min(t / 2.5, 1);
      v.sink = -1.3 * k;
      v.tilt = 0.3 * k;
      return k < 1;
    });
  }

  private tween(from: Vector3, to: Vector3, seconds: number, apply: (p: Vector3) => void): void {
    let t = 0;
    const p = new Vector3();
    this.animations.push((dt) => {
      t += dt;
      const k = Math.min(t / seconds, 1);
      const e = k * k * (3 - 2 * k);
      Vector3.LerpToRef(from, to, e, p);
      apply(p);
      return k < 1;
    });
  }

  private clearMarks(): void {
    for (const m of this.marks) m.dispose();
    this.marks = [];
  }

  /** Draws what we know about the enemy sea: buoys for misses, fires for hits, dots for empty water. */
  private rebuildMarks(): void {
    this.clearMarks();
    const view = viewFor(this.state, ME);
    for (const [key, mark] of Object.entries(view.enemyMarks)) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const at = cellCenter('enemy', { x, y });
      if (mark === 'miss') {
        const b = MeshBuilder.CreateCylinder('buoy', { diameterTop: 0.6, diameterBottom: 1.8, height: 2, tessellation: 6 }, this.scene);
        b.convertToFlatShadedMesh();
        b.material = mat(this.scene, 'splash', { emissive: 0.25 });
        b.position = at.add(new Vector3(0, 1, 0));
        b.isPickable = false;
        this.marks.push(b);
      } else if (mark === 'empty') {
        const d = MeshBuilder.CreateDisc('empty', { radius: 0.9, tessellation: 6 }, this.scene);
        d.rotation.x = Math.PI / 2;
        d.material = mat(this.scene, 'foam', { emissive: 0.4, alpha: 0.7 });
        d.position = at.add(new Vector3(0, 1.25, 0));
        d.isPickable = false;
        this.marks.push(d);
      } else if (mark === 'hit') {
        const plate = MeshBuilder.CreateDisc('scorch', { radius: 3.4, tessellation: 6 }, this.scene);
        plate.rotation.x = Math.PI / 2;
        plate.material = mat(this.scene, 'wreck', { alpha: 0.85 });
        plate.position = at.add(new Vector3(0, 1.2, 0));
        plate.isPickable = false;
        this.marks.push(plate, this.fx.burning(at.add(new Vector3(0, 1.5, 0))));
      }
    }
    this.hud.setEnemy(view.enemyAfloat);
  }

  // ---------------------------------------------------------------- input

  private groundPoint(x: number, y: number): Vector3 | null {
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.rig.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = -ray.origin.y / ray.direction.y;
    return t > 0 ? ray.origin.add(ray.direction.scale(t)) : null;
  }

  private bindInput(): void {
    let down: { x: number; y: number } | null = null;
    let dragging = false;
    this.scene.onPointerObservable.add((info) => {
      const ev = info.event as PointerEvent;
      if (info.type === PointerEventTypes.POINTERDOWN) {
        down = { x: ev.clientX, y: ev.clientY };
        dragging = false;
      } else if (info.type === PointerEventTypes.POINTERMOVE) {
        if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 8) dragging = true;
        if (down && dragging) {
          this.rig.orbit(-(ev.movementX || 0) * 0.006);
        } else {
          const hit = this.groundPoint(this.scene.pointerX, this.scene.pointerY);
          const c = hit && worldToCell(hit);
          this.hoverCell = c && c.side === 'enemy' ? c.cell : null;
        }
      } else if (info.type === PointerEventTypes.POINTERUP) {
        if (down && !dragging) this.click(this.scene.pointerX, this.scene.pointerY);
        down = null;
        dragging = false;
      } else if (info.type === PointerEventTypes.POINTERWHEEL) {
        this.rig.cycleZoom((ev as unknown as WheelEvent).deltaY > 0 ? 1 : -1);
      }
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'tab') {
        e.preventDefault();
        this.cycleShip();
      } else if (k === ' ' || k === 'enter') {
        e.preventDefault();
        this.ready();
      } else if (k === 'm') this.rig.setMode('overview');
      else if (k === 'v') this.rig.toggle('chase');
      else if (k === 'f') this.rig.toggle('aim');
      else if (k === 'n') this.hud.setMuted(this.sfx.toggleMute());
      else if (k === 'w' || k === 'arrowup') this.planMove(0, -1);
      else if (k === 's' || k === 'arrowdown') this.planMove(0, 1);
      else if (k === 'a' || k === 'arrowleft') this.planMove(-1, 0);
      else if (k === 'd' || k === 'arrowright') this.planMove(1, 0);
    });
  }

  click(x: number, y: number): void {
    const hit = this.groundPoint(x, y);
    const c = hit && worldToCell(hit);
    if (!c) return;
    if (c.side === 'enemy') {
      this.aimAt(c.cell);
      return;
    }
    const mine = this.state.teams[0].ships.find(
      (s) => !s.sunk && shipCells(s.placement).some((cc) => cc.x === c.cell.x && cc.y === c.cell.y),
    );
    if (mine && mine.placement.id !== this.active) {
      this.active = mine.placement.id;
      this.sfx.click();
    }
  }

  // ---------------------------------------------------------------- frame

  private update(dt: number): void {
    this.time += dt;
    const due = this.timers.filter((t) => t.at <= this.time);
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();
    this.animations = this.animations.filter((a) => a(dt));
    this.fx.update(dt);

    if (this.phase === 'plan') {
      this.planLeft -= dt;
      if (this.planLeft <= 0) this.resolve();
    }

    // Ships bob on the waves.
    const bob = (v: ShipVisual) => {
      const h = waveHeight(v.pos.x, v.pos.z, this.time);
      const hx = waveHeight(v.pos.x + 3, v.pos.z, this.time) - waveHeight(v.pos.x - 3, v.pos.z, this.time);
      const hz = waveHeight(v.pos.x, v.pos.z + 3, this.time) - waveHeight(v.pos.x, v.pos.z - 3, this.time);
      v.node.position.set(v.pos.x, h * 0.8 + v.sink, v.pos.z);
      v.node.rotation.set(-hz * 0.06 + v.tilt * 0.4, v.yaw, hx * 0.06 + v.tilt);
      if (v.foam) {
        v.foam.position.set(v.pos.x, h + 0.25, v.pos.z);
        v.foam.rotation.y = v.yaw;
      }
    };
    for (const v of this.ships.values()) bob(v);
    for (const v of this.wrecks) bob(v);

    // Ghosts for planned moves.
    for (const [id, v] of this.ships) {
      const ship = this.myShip(id);
      const m = this.plans.get(id)?.move;
      const show = this.phase === 'plan' && !!ship && !!m;
      v.ghost.setEnabled(show);
      if (show) {
        const target = shipCenter('home', this.planned(ship!.placement));
        v.ghost.position.set(target.x, 0.3, target.z);
        v.ghost.rotation.y = v.yaw;
      }
    }

    // Active ship: camera anchor and the floating pointer.
    const active = this.ships.get(this.active);
    if (active) {
      this.rig.anchor.copyFrom(active.pos);
      this.pointer.setEnabled(this.phase === 'plan');
      this.pointer.position.set(active.pos.x, 11 + Math.sin(this.time * 3) * 0.8, active.pos.z);
      this.pointer.rotation.y += dt;
    }

    // Hover square and the aim point.
    this.hover.setEnabled(this.phase === 'plan' && !!this.hoverCell);
    if (this.hoverCell) {
      this.hover.position = cellCenter('enemy', this.hoverCell, 1.25);
    }
    for (const [i, m] of this.targetMarkers.entries()) m.visibility = 0.55 + 0.35 * Math.sin(this.time * 5 + i);
    if (this.followShell && !this.followShell.isDisposed()) this.rig.focus = this.followShell.position;

    this.sea.setGridEmphasis(this.rig.mode === 'chase' ? 0.3 : 1);
    this.rig.update(dt, this.engine.getAspectRatio(this.rig.camera));
    this.sea.update(this.time, this.rig.camera.position);

    // HUD.
    this.hud.setViews(this.rig.mode);
    this.hud.setCellLabel(this.phase === 'plan' && this.hoverCell ? cellLabel(this.hoverCell) : null);
    this.hud.setRound(this.state.round + 1, this.phase, Math.max(this.planLeft, 0), PLAN_SECONDS);
    const shots = this.totalShots();
    this.hud.setShots(shots.planned, shots.available);
    const ship = this.myShip(this.active);
    if (ship) {
      const p = this.plans.get(this.active);
      const mv = p?.move;
      this.hud.setCard({
        cls: ship.placement.cls,
        cell: cellLabel(ship.placement),
        shots: p?.targets.length ?? 0,
        maxShots: SHIP_CLASSES[ship.placement.cls].shotsPerRound,
        move: mv ? `${mv.dx >= 0 ? '+' : ''}${mv.dx}, ${mv.dy >= 0 ? '+' : ''}${mv.dy}` : `up to ${SHIP_CLASSES[ship.placement.cls].speed}`,
        damaged: ship.hits.length,
      });
    }
  }
}
