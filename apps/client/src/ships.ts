import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import { type ShipClass, SHIP_CLASSES } from '@tidebound/shared';
import { CELL } from './world';

export type Team = 'blue' | 'red';

export const CLASS_NAMES: Record<ShipClass, string> = {
  ironclad: 'Ironclad',
  corvette: 'Corvette',
  cutter: 'Cutter',
  skiff: 'Skiff',
};

/**
 * Chunky toy-boat proportions: short, wide, tall-sided hulls with a fat rim,
 * oversized guns and rounded superstructures, all with a dark ink outline.
 */
interface Dims {
  L: number;
  B: number;
  free: number;
  draft: number;
  rim: number;
}

function dims(cls: ShipClass): Dims {
  const L = SHIP_CLASSES[cls].size * CELL * 0.88;
  switch (cls) {
    case 'ironclad':
      return { L, B: 7.8, free: 2.5, draft: 1.6, rim: 0.48 };
    case 'corvette':
      return { L, B: 7.2, free: 2.3, draft: 1.5, rim: 0.44 };
    case 'cutter':
      return { L, B: 6.6, free: 2.1, draft: 1.4, rim: 0.4 };
    case 'skiff':
      return { L, B: 5.6, free: 1.8, draft: 1.2, rim: 0.36 };
  }
}

const INK = Color3.FromHexString('#1a1d22');

// ------------------------------------------------------------------ looks

interface Look {
  hull: string;
  rim: string;
  deck: string;
  boot: string;
  bottom: string;
  super: string;
  roof: string;
  window: string;
  accent: string;
  gun: string;
  dark: string;
}

const LOOKS: Record<Team, Look> = {
  // Player fleet: steel grey with a blue trim.
  blue: {
    hull: '#7d8b99',
    rim: '#aebac6',
    deck: '#5d6874',
    boot: '#2a3038',
    bottom: '#a8412f',
    super: '#c3ccd5',
    roof: '#e2e8ee',
    window: '#3f86d0',
    accent: '#3fa7f0',
    gun: '#56616c',
    dark: '#2b3138',
  },
  // Enemy fleet: olive drab with an orange trim.
  red: {
    hull: '#6e7a44',
    rim: '#9aa766',
    deck: '#545d32',
    boot: '#2c2e22',
    bottom: '#9a3a2a',
    super: '#b6be88',
    roof: '#d4d9a8',
    window: '#2f6f86',
    accent: '#f0703f',
    gun: '#4d5434',
    dark: '#2d2f24',
  },
};

// ------------------------------------------------------------------ materials

const matCache = new Map<string, PBRMaterial>();

/** Satin toy paint: no metal, soft highlight. */
function paint(scene: Scene, hex: string, roughness = 0.55): PBRMaterial {
  const id = `paint|${hex}|${roughness}`;
  const hit = matCache.get(id);
  if (hit && hit.getScene() === scene) return hit;
  const m = new PBRMaterial(id, scene);
  m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  m.metallic = 0;
  m.roughness = roughness;
  matCache.set(id, m);
  return m;
}

function vertexPaint(scene: Scene): PBRMaterial {
  const id = 'paint|vertex';
  const hit = matCache.get(id);
  if (hit && hit.getScene() === scene) return hit;
  const m = new PBRMaterial(id, scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = 0.5;
  matCache.set(id, m);
  return m;
}

/** A texture-painted material (stripes, hull numbers). */
function painted(scene: Scene, id: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, alpha: boolean): PBRMaterial {
  const hit = matCache.get(id);
  if (hit && hit.getScene() === scene) return hit;
  const tex = new DynamicTexture(id, { width: w, height: h }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  draw(ctx, w, h);
  tex.hasAlpha = alpha;
  tex.update();
  const m = new PBRMaterial(id, scene);
  m.albedoTexture = tex;
  m.metallic = 0;
  m.roughness = 0.6;
  if (alpha) {
    m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = 0.4;
  }
  matCache.set(id, m);
  return m;
}

function stripes(scene: Scene, a: string, b: string): PBRMaterial {
  return painted(
    scene,
    `stripes|${a}|${b}`,
    (ctx, w, h) => {
      const n = 8;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = i % 2 ? b : a;
        ctx.fillRect((i * w) / n, 0, w / n + 1, h);
      }
    },
    64,
    8,
    false,
  );
}

function hullNumber(scene: Scene, num: number): PBRMaterial {
  return painted(
    scene,
    `num|${num}`,
    (ctx, w, h) => {
      ctx.font = `900 ${Math.round(h * 0.86)}px "Arial Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#1a1d22';
      ctx.strokeText(String(num), w / 2, h * 0.54);
      ctx.fillStyle = '#f4f6f8';
      ctx.fillText(String(num), w / 2, h * 0.54);
    },
    128,
    96,
    true,
  );
}

// ------------------------------------------------------------------ shapes

/**
 * A rounded box (superellipsoid). `sharp` near 0 is boxy, 1 is a sphere.
 * Normals are analytic, so there are no seams.
 */
function blob(scene: Scene, w: number, h: number, d: number, sharp = 0.3, segments = 14): Mesh {
  const m = MeshBuilder.CreateSphere('blob', { diameter: 2, segments }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const nor = new Array<number>(pos.length);
  const half = [w / 2, h / 2, d / 2];
  for (let i = 0; i < pos.length; i += 3) {
    let len = 0;
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k]!;
      const a = half[k]!;
      pos[i + k] = Math.sign(v) * Math.pow(Math.abs(v), sharp) * a;
      const n = (Math.sign(v) * Math.pow(Math.abs(v), 2 - sharp)) / a;
      nor[i + k] = n;
      len += n * n;
    }
    len = Math.sqrt(len) || 1;
    for (let k = 0; k < 3; k++) nor[i + k] = nor[i + k]! / len;
  }
  m.setVerticesData(VertexBuffer.PositionKind, pos);
  m.setVerticesData(VertexBuffer.NormalKind, nor);
  m.refreshBoundingInfo();
  return m;
}

function paintVertices(m: Mesh, pick: (x: number, y: number, z: number) => Color3): void {
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const cols: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const c = pick(pos[i]!, pos[i + 1]!, pos[i + 2]!).toLinearSpace();
    cols.push(c.r, c.g, c.b, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
}

// ------------------------------------------------------------------ hull

interface HullShape {
  halfBeam(z: number): number;
  /** Height of the hull's top edge (under the rim). */
  sheer(z: number): number;
  /** Height of the recessed deck surface parts stand on. */
  deck(z: number): number;
}

function hullShape(d: Dims): HullShape {
  const { L, B, free } = d;
  const halfBeam = (z: number) => {
    const u = (2 * z) / L; // -1 stern .. +1 bow
    if (u > 0.05) {
      const k = Math.min((u - 0.05) / 0.95, 1);
      return (B / 2) * Math.pow(1 - Math.pow(k, 2.1), 1 / 2.1);
    }
    if (u < -0.35) {
      const k = Math.min((-u - 0.35) / 0.65, 1);
      return (B / 2) * Math.pow(1 - Math.pow(k, 2.8), 1 / 2.8);
    }
    return B / 2;
  };
  const sheer = (z: number) => {
    const u = (2 * z) / L;
    return free + 1.3 * Math.pow(Math.max(u - 0.15, 0) / 0.85, 2) + 0.45 * Math.pow(Math.max(-u - 0.4, 0) / 0.6, 2);
  };
  return { halfBeam, sheer, deck: (z) => sheer(z) - 0.22 };
}

/** Cosine-spaced stations, denser at the rounded ends. */
function stations(L: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(-L / 2 + ((1 - Math.cos((Math.PI * i) / n)) / 2) * L);
  return out;
}

/** Hull shell, fat rim and recessed deck as one vertex-painted mesh. */
function buildHull(scene: Scene, d: Dims, s: HullShape, look: Look): Mesh {
  const { draft, rim } = d;
  const zs = stations(d.L, 40);
  const bottom = Color3.FromHexString(look.bottom);
  const boot = Color3.FromHexString(look.boot);
  const hullC = Color3.FromHexString(look.hull);

  // Bulging side: wider just below the rim, rounding hard into a shallow bottom.
  const profile = (top: number): [number, number][] => [
    [0.96, top],
    [1.04, top * 0.62],
    [1.03, top * 0.25],
    [0.98, -draft * 0.3],
    [0.86, -draft * 0.68],
    [0.58, -draft * 0.92],
    [0.0, -draft],
  ];
  const paths: Vector3[][] = [];
  for (const z of zs) {
    const hb = Math.max(s.halfBeam(z), 0.03);
    const top = s.sheer(z);
    const port = profile(top).map(([k, y]) => new Vector3(hb * k, y, z));
    const star = port.slice(0, -1).reverse().map((p) => new Vector3(-p.x, p.y, p.z));
    paths.push([...port, ...star]);
  }
  const shell = MeshBuilder.CreateRibbon('hull', { pathArray: paths, sideOrientation: Mesh.BACKSIDE }, scene);
  paintVertices(shell, (_x, y) => (y < -0.3 ? bottom : y < 0.35 ? boot : hullC));

  // Rim: a fat tube around the deck edge.
  const loop: Vector3[] = [];
  const edge = zs.slice(1, -1);
  for (const z of edge) loop.push(new Vector3(s.halfBeam(z) * 0.96, s.sheer(z) + rim * 0.15, z));
  loop.push(new Vector3(0, s.sheer(d.L / 2) + rim * 0.15, d.L / 2 - rim * 0.2));
  for (const z of [...edge].reverse()) loop.push(new Vector3(-s.halfBeam(z) * 0.96, s.sheer(z) + rim * 0.15, z));
  loop.push(new Vector3(0, s.sheer(-d.L / 2) + rim * 0.15, -d.L / 2 + rim * 0.2));
  loop.push(loop[0]!.clone(), loop[1]!.clone());
  const tube = MeshBuilder.CreateTube('rim', { path: loop, radius: rim, tessellation: 12 }, scene);
  paintVertices(tube, () => Color3.FromHexString(look.rim));

  // Deck, sunk below the rim.
  const deckPaths: Vector3[][] = [];
  for (const z of zs) {
    const hb = Math.max(s.halfBeam(z) * 0.96, 0.02);
    const y = s.deck(z);
    deckPaths.push([new Vector3(-hb, y, z), new Vector3(0, y + 0.06, z), new Vector3(hb, y, z)]);
  }
  const deck = MeshBuilder.CreateRibbon('deck', { pathArray: deckPaths, sideOrientation: Mesh.DOUBLESIDE }, scene);
  paintVertices(deck, () => Color3.FromHexString(look.deck));

  const hull = Mesh.MergeMeshes([shell, tube, deck], true, true)!;
  hull.material = vertexPaint(scene);
  hull.useVertexColors = true;
  return hull;
}

// ------------------------------------------------------------------ parts

class Kit {
  /** Outlined chunky parts. */
  readonly parts: Mesh[] = [];
  /** Flat details (portholes, numbers) drawn without outline. */
  readonly details: Mesh[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly look: Look,
  ) {}

  private add<T extends Mesh>(m: T, hex: string, roughness = 0.55): T {
    m.material = paint(this.scene, hex, roughness);
    this.parts.push(m);
    return m;
  }

  /** A rounded deckhouse with a band of windows and a pale roof. */
  house(w: number, h: number, d: number, x: number, y: number, z: number, windows = true): void {
    const b = blob(this.scene, w, h, d, 0.28);
    b.position.set(x, y + h / 2, z);
    this.add(b, this.look.super);
    const roof = blob(this.scene, w * 1.06, Math.min(0.32, h * 0.2), d * 1.06, 0.3);
    roof.position.set(x, y + h, z);
    this.add(roof, this.look.roof);
    if (windows) {
      const band = blob(this.scene, w * 1.02, Math.min(0.55, h * 0.26), d * 1.02, 0.22);
      band.position.set(x, y + h * 0.66, z);
      this.add(band, this.look.window, 0.25);
    }
  }

  /** A fat oval funnel with a coloured band and a dark lip. */
  funnel(w: number, h: number, x: number, y: number, z: number): void {
    const f = MeshBuilder.CreateCylinder('funnel', { diameterTop: w * 0.9, diameterBottom: w, height: h, tessellation: 24 }, this.scene);
    f.scaling.z = 1.3;
    f.position.set(x, y + h / 2, z);
    this.add(f, this.look.super);
    const band = MeshBuilder.CreateCylinder('band', { diameterTop: w * 0.95, diameterBottom: w * 0.97, height: h * 0.2, tessellation: 24 }, this.scene);
    band.scaling.z = 1.3;
    band.position.set(x, y + h * 0.62, z);
    this.add(band, this.look.accent);
    const lip = MeshBuilder.CreateTorus('lip', { diameter: w * 0.9, thickness: w * 0.16, tessellation: 24 }, this.scene);
    lip.scaling.z = 1.3;
    lip.position.set(x, y + h, z);
    this.add(lip, this.look.dark);
    const hole = MeshBuilder.CreateCylinder('hole', { diameter: w * 0.8, height: 0.05, tessellation: 20 }, this.scene);
    hole.scaling.z = 1.3;
    hole.position.set(x, y + h - 0.05, z);
    this.add(hole, '#121417', 0.9);
  }

  /** A domed gun turret with big barrels and muzzle rings, facing ±z. */
  turret(size: number, barrels: 1 | 2, x: number, y: number, z: number, facing: 1 | -1): void {
    const ring = MeshBuilder.CreateCylinder('ring', { diameter: size * 1.05, height: size * 0.16, tessellation: 24 }, this.scene);
    ring.position.set(x, y + size * 0.08, z);
    this.add(ring, this.look.dark);
    const dome = blob(this.scene, size, size * 0.62, size * 1.15, 0.5, 18);
    dome.position.set(x, y + size * 0.22, z - facing * size * 0.05);
    this.add(dome, this.look.gun);
    const mantlet = blob(this.scene, size * (barrels === 2 ? 0.72 : 0.46), size * 0.32, size * 0.3, 0.35);
    mantlet.position.set(x, y + size * 0.32, z + facing * size * 0.48);
    this.add(mantlet, this.look.dark);
    const dia = size * (barrels === 2 ? 0.17 : 0.22);
    const len = size * 1.0;
    for (let i = 0; i < barrels; i++) {
      const bx = x + (barrels === 2 ? (i - 0.5) * size * 0.34 : 0);
      const bz = z + facing * (size * 0.5 + len / 2);
      const by = y + size * 0.34 + len * 0.06;
      const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: dia, height: len, tessellation: 14 }, this.scene);
      barrel.rotation.x = facing * (Math.PI / 2 - 0.12);
      barrel.position.set(bx, by, bz);
      this.add(barrel, this.look.gun);
      const muzzle = MeshBuilder.CreateCylinder('muzzle', { diameter: dia * 1.45, height: size * 0.2, tessellation: 14 }, this.scene);
      muzzle.rotation.x = barrel.rotation.x;
      muzzle.position.set(bx, by + len * 0.06, z + facing * (size * 0.5 + len * 0.98));
      this.add(muzzle, this.look.dark);
    }
  }

  /** A stout mast with a lookout bulb, a yard and a radar paddle. */
  mast(h: number, x: number, y: number, z: number): void {
    const pole = MeshBuilder.CreateCylinder('mast', { diameterTop: 0.22, diameterBottom: 0.42, height: h, tessellation: 12 }, this.scene);
    pole.position.set(x, y + h / 2, z);
    this.add(pole, this.look.super);
    const yard = MeshBuilder.CreateCylinder('yard', { diameter: 0.2, height: h * 0.55, tessellation: 8 }, this.scene);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(x, y + h * 0.66, z);
    this.add(yard, this.look.super);
    const nest = blob(this.scene, 0.9, 0.6, 0.9, 0.5, 12);
    nest.position.set(x, y + h * 0.82, z);
    this.add(nest, this.look.roof);
    const radar = blob(this.scene, h * 0.32, 0.36, 0.3, 0.35);
    radar.position.set(x, y + h + 0.1, z);
    this.add(radar, this.look.accent);
  }

  lifeboat(x: number, y: number, z: number, len: number): void {
    const b = blob(this.scene, 1.1, 0.7, len, 0.55);
    b.position.set(x, y + 0.55, z);
    this.add(b, '#f2f4f5', 0.45);
    const cover = blob(this.scene, 0.9, 0.35, len * 0.8, 0.5);
    cover.position.set(x, y + 0.92, z);
    this.add(cover, this.look.accent);
  }

  /** An orange-and-white life ring hanging on a wall facing ±x. */
  buoy(x: number, y: number, z: number, side: 1 | -1, size = 1): void {
    const t = MeshBuilder.CreateTorus('buoy', { diameter: 0.95 * size, thickness: 0.32 * size, tessellation: 16 }, this.scene);
    t.rotation.z = Math.PI / 2;
    t.position.set(x + side * 0.12, y, z);
    t.material = stripes(this.scene, '#f07a2c', '#f5f5ef');
    this.parts.push(t);
  }

  bollards(x: number, y: number, z: number): void {
    for (const dz of [-0.35, 0.35]) {
      const b = MeshBuilder.CreateCylinder('bollard', { diameterTop: 0.42, diameterBottom: 0.36, height: 0.5, tessellation: 10 }, this.scene);
      b.position.set(x, y + 0.25, z + dz);
      this.add(b, this.look.dark);
    }
  }

  crate(w: number, h: number, x: number, y: number, z: number): void {
    const b = blob(this.scene, w, h, w, 0.2);
    b.position.set(x, y + h / 2, z);
    this.add(b, '#b98552', 0.7);
  }

  drum(x: number, y: number, z: number): void {
    const b = MeshBuilder.CreateCylinder('drum', { diameter: 0.7, height: 0.9, tessellation: 12 }, this.scene);
    b.position.set(x, y + 0.45, z);
    this.add(b, this.look.accent);
  }

  porthole(x: number, y: number, z: number, yaw: number, r = 0.26): void {
    const p = MeshBuilder.CreateCylinder('port', { diameter: r * 2, height: 0.08, tessellation: 14 }, this.scene);
    p.rotation.set(0, yaw, Math.PI / 2);
    p.position.set(x, y, z);
    p.material = paint(this.scene, '#e8edf0', 0.4);
    this.details.push(p);
    const glass = MeshBuilder.CreateCylinder('glass', { diameter: r * 1.3, height: 0.1, tessellation: 14 }, this.scene);
    glass.rotation.copyFrom(p.rotation);
    glass.position.set(x + Math.sign(x) * 0.02, y, z);
    glass.material = paint(this.scene, '#22303d', 0.2);
    this.details.push(glass);
  }

  decal(mat: PBRMaterial, w: number, h: number, x: number, y: number, z: number, yaw: number): void {
    const p = MeshBuilder.CreatePlane('decal', { width: w, height: h }, this.scene);
    p.rotation.y = yaw;
    p.position.set(x, y, z);
    p.material = mat;
    this.details.push(p);
  }
}

// ------------------------------------------------------------------ ships

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Puts portholes and hull numbers on both sides, following the hull's curve. */
function dressHull(k: Kit, scene: Scene, d: Dims, s: HullShape, num: number): void {
  const sideAt = (z: number) => s.halfBeam(z) * 1.04 + 0.04;
  const yawAt = (z: number) => Math.atan2(s.halfBeam(z + 0.2) - s.halfBeam(z - 0.2), 0.4);
  const y = d.free * 0.6;
  const step = d.L > 20 ? 2.4 : 1.9;
  const from = -d.L * 0.3;
  const to = d.L * (d.L > 12 ? 0.08 : 0.12);
  for (let z = from; z <= to; z += step) {
    for (const side of [1, -1] as const) k.porthole(side * sideAt(z), y, z, side * yawAt(z));
  }
  const nz = d.L * (d.L > 12 ? 0.3 : 0.26);
  const nh = Math.min(d.free * 0.72, 1.6);
  const mat = hullNumber(scene, num);
  for (const side of [1, -1] as const) {
    // Planes face -z by default; turn them to face outboard.
    k.decal(mat, nh * 1.33, nh, side * (sideAt(nz) + 0.22), y - 0.05, nz, -side * Math.PI / 2 + side * yawAt(nz));
  }
}

/**
 * Builds an original toy-style warship for a class. Bow along local +z,
 * waterline at y = 0. Returns a root node so callers can move, bob and tilt it.
 */
export function buildShip(scene: Scene, cls: ShipClass, team: Team, name: string): TransformNode {
  const d = dims(cls);
  const s = hullShape(d);
  const look = LOOKS[team];
  const hull = buildHull(scene, d, s, look);
  const k = new Kit(scene, look);
  const at = (t: number) => t * d.L; // -0.5 stern .. 0.5 bow
  const dy = (t: number) => s.deck(at(t));
  const hb = (t: number) => s.halfBeam(at(t));
  const B = d.B;

  switch (cls) {
    case 'ironclad': {
      k.turret(4.4, 2, 0, dy(0.32), at(0.32), 1);
      const barbette = blob(scene, 3.6, 1.3, 3.6, 0.45);
      barbette.position.set(0, dy(0.18) + 0.65, at(0.18));
      barbette.material = paint(scene, look.super);
      k.parts.push(barbette);
      k.turret(4.0, 2, 0, dy(0.18) + 1.3, at(0.18), 1);
      k.house(B * 0.7, 2.5, d.L * 0.2, 0, dy(0.02), at(0.02));
      k.house(B * 0.54, 1.9, d.L * 0.12, 0, dy(0.02) + 2.5, at(0.04));
      k.house(B * 0.4, 1.4, d.L * 0.07, 0, dy(0.02) + 4.4, at(0.055));
      k.mast(5.5, 0, dy(0.02) + 5.8, at(0.04));
      k.funnel(2.8, 4.4, 0, dy(-0.11), at(-0.11));
      k.house(B * 0.56, 2.0, d.L * 0.13, 0, dy(-0.22), at(-0.22));
      k.turret(4.0, 2, 0, dy(-0.36), at(-0.36), -1);
      for (const side of [1, -1] as const) {
        k.lifeboat(side * hb(-0.1) * 0.66, dy(-0.1), at(-0.1), 3.2);
        k.buoy(side * B * 0.35, dy(0.02) + 1.3, at(0.02), side);
        k.buoy(side * B * 0.28, dy(-0.22) + 1.1, at(-0.22), side);
        k.bollards(side * hb(0.4) * 0.6, dy(0.4), at(0.4));
        k.bollards(side * hb(-0.44) * 0.6, dy(-0.44), at(-0.44));
      }
      break;
    }
    case 'corvette': {
      k.turret(3.9, 2, 0, dy(0.28), at(0.28), 1);
      k.house(B * 0.68, 2.4, d.L * 0.26, 0, dy(0.04), at(0.04));
      k.house(B * 0.5, 1.6, d.L * 0.13, 0, dy(0.04) + 2.4, at(0.08));
      k.mast(4.6, 0, dy(0.04) + 4.0, at(0.06));
      k.funnel(2.4, 3.6, 0, dy(-0.14), at(-0.14));
      k.turret(3.4, 1, 0, dy(-0.34), at(-0.34), -1);
      for (const side of [1, -1] as const) {
        k.lifeboat(side * hb(-0.14) * 0.64, dy(-0.14), at(-0.14), 2.6);
        k.buoy(side * B * 0.34, dy(0.04) + 1.2, at(-0.02), side);
        k.bollards(side * hb(0.42) * 0.55, dy(0.42), at(0.42));
      }
      break;
    }
    case 'cutter': {
      k.turret(3.3, 1, 0, dy(0.27), at(0.27), 1);
      k.house(B * 0.7, 2.2, d.L * 0.32, 0, dy(-0.01), at(-0.01));
      k.house(B * 0.52, 1.4, d.L * 0.16, 0, dy(-0.01) + 2.2, at(0.04));
      k.mast(3.6, 0, dy(-0.01) + 3.6, at(0.03));
      k.funnel(1.9, 2.8, 0, dy(-0.01) + 2.2, at(-0.12));
      k.crate(1.3, 1.0, -B * 0.16, dy(-0.36), at(-0.33));
      k.drum(B * 0.18, dy(-0.36), at(-0.36));
      for (const side of [1, -1] as const) {
        k.buoy(side * B * 0.35, dy(-0.01) + 1.15, at(-0.06), side);
        k.bollards(side * hb(0.4) * 0.5, dy(0.4), at(0.4));
      }
      break;
    }
    case 'skiff': {
      // A stubby tug-like patrol boat.
      k.house(B * 0.66, 1.7, d.L * 0.38, 0, dy(-0.08), at(-0.08));
      k.house(B * 0.52, 1.3, d.L * 0.2, 0, dy(-0.08) + 1.7, at(-0.02));
      k.funnel(1.3, 1.7, 0, dy(-0.08) + 1.7, at(-0.2));
      k.mast(2.4, 0, dy(-0.08) + 3.0, at(-0.02));
      k.turret(2.4, 1, 0, dy(0.32), at(0.32), 1);
      for (const side of [1, -1] as const) {
        k.buoy(side * B * 0.33, dy(-0.08) + 0.95, at(-0.08), side, 0.85);
        k.bollards(side * hb(-0.4) * 0.5, dy(-0.4), at(-0.4));
      }
      break;
    }
  }

  dressHull(k, scene, d, s, 10 + (hash(name) % 90));

  const top = Mesh.MergeMeshes(k.parts, true, true, undefined, false, true)!;
  top.name = `${name}-top`;
  const details = Mesh.MergeMeshes(k.details, true, true, undefined, false, true)!;
  details.name = `${name}-details`;
  const root = new TransformNode(name, scene);
  for (const m of [hull, top, details]) {
    m.parent = root;
    m.isPickable = false;
    m.receiveShadows = true;
  }
  for (const m of [hull, top]) {
    m.renderOutline = true;
    m.outlineColor = INK;
    m.outlineWidth = 0.07;
  }
  return root;
}

/** Makes a ghost copy for showing a planned move. */
export function ghostOf(scene: Scene, source: TransformNode, name: string): TransformNode {
  const root = new TransformNode(name, scene);
  const ghost = new StandardMaterial(`${name}-mat`, scene);
  ghost.diffuseColor = Color3.FromHexString('#7dff9a');
  ghost.emissiveColor = Color3.FromHexString('#4ad66d');
  ghost.alpha = 0.35;
  ghost.disableLighting = true;
  for (const child of source.getChildMeshes(true)) {
    if (child.name.endsWith('-details')) continue;
    const clone = (child as Mesh).clone(`${name}-mesh`, root);
    if (clone) {
      clone.material = ghost;
      clone.isPickable = false;
      clone.useVertexColors = false;
      clone.renderOutline = false;
    }
  }
  root.setEnabled(false);
  return root;
}

/** Soft foam ring where the hull meets the water. */
export function foamRing(scene: Scene, cls: ShipClass, name: string): Mesh {
  const d = dims(cls);
  const tex = foamTexture(scene);
  const plane = MeshBuilder.CreateGround(name, { width: d.B + 4, height: d.L + 5 }, scene);
  const m = new StandardMaterial(`${name}-mat`, scene);
  m.diffuseTexture = tex;
  m.opacityTexture = tex;
  m.emissiveColor = new Color3(0.9, 0.95, 0.95);
  m.disableLighting = true;
  m.backFaceCulling = false;
  plane.material = m;
  plane.isPickable = false;
  return plane;
}

let foamTex: DynamicTexture | null = null;
function foamTexture(scene: Scene): DynamicTexture {
  if (foamTex && foamTex.getScene() === scene) return foamTex;
  const t = new DynamicTexture('foam', { width: 128, height: 256 }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 256);
  // Ellipse ring: bright at the hull edge, fading outward, with speckles.
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.72 + Math.pow(Math.random(), 2) * 0.28;
    const x = 64 + Math.cos(a) * 56 * r;
    const y = 128 + Math.sin(a) * 120 * r;
    ctx.fillStyle = `rgba(255,255,255,${(1 - (r - 0.72) / 0.28) * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  t.hasAlpha = true;
  t.update();
  foamTex = t;
  return t;
}
