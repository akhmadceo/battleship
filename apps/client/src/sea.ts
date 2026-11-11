import {
  Color3,
  Color4,
  DynamicTexture,
  Effect,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  type Scene,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  Vector4,
  VertexBuffer,
} from '@babylonjs/core';
import { COLUMN_LETTERS, GRID_SIZE, createRng } from '@tidebound/shared';
import { BOARD_SPAN, CELL, GRID_ORIGIN, type Side } from './world';

/**
 * The world: a deep blue sky full of clouds with two floating islands, each
 * holding one 10×10 board as a lagoon. Ours is on the left, the enemy's on the
 * right. Everything is generated; nothing is downloaded.
 */

/** Direction the sunlight travels (from the sun toward the ground): from front-left, above. */
export const SUN_DIR = new Vector3(0.5, -0.66, 0.56).normalize();

const SKY_TOP = Color3.FromHexString('#1544b5');
const SKY_MID = Color3.FromHexString('#2f80e3');
const SKY_HORIZON = Color3.FromHexString('#a8d8f8');
const SKY_BELOW = Color3.FromHexString('#78b2ec');
const FOG = Color3.FromHexString('#8fc2f1');
export const FOG_DENSITY = 0.0006;

/** How far the rim of rock reaches out from the lagoon's edge. */
const RIM = 14;

const WATER_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
varying vec3 vWorld;
varying float vHeight;

// Must match waveHeight() in world.ts.
float waveHeight(vec2 p, float t) {
  return 0.28 * sin(p.x * 0.045 + t * 0.9)
       + 0.2 * sin(p.y * 0.06 - t * 1.1)
       + 0.12 * sin((p.x + p.y) * 0.11 + t * 1.7);
}

void main() {
  vec4 wp = world * vec4(position, 1.0);
  float h = waveHeight(wp.xz, time);
  wp.y += h;
  vWorld = wp.xyz;
  vHeight = h;
  gl_Position = viewProjection * wp;
}
`;

const WATER_FRAGMENT = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform float time;
uniform vec3 cameraPos;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
uniform vec3 foamColor;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec4 gridHome;   // x0, z0, cells, cell size
uniform vec4 gridEnemy;
uniform float gridAlpha;
varying vec3 vWorld;
varying float vHeight;

vec2 waveSlope(vec2 p, float t) {
  float a = cos(p.x * 0.045 + t * 0.9) * 0.28 * 0.045;
  float b = cos(p.y * 0.06 - t * 1.1) * 0.2 * 0.06;
  float c = cos((p.x + p.y) * 0.11 + t * 1.7) * 0.12 * 0.11;
  return vec2(a + c, b + c);
}

vec2 rippleSlope(vec2 p, float t) {
  vec2 s = vec2(0.0);
  s += 0.07 * cos(dot(p, vec2(0.31, 0.18)) + t * 2.1) * vec2(0.31, 0.18);
  s += 0.05 * cos(dot(p, vec2(-0.22, 0.37)) - t * 2.6) * vec2(-0.22, 0.37);
  s += 0.04 * cos(dot(p, vec2(0.61, -0.43)) + t * 3.3) * vec2(0.61, -0.43);
  return s;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float gridLines(vec2 p, vec4 g) {
  vec2 local = (p - g.xy) / g.w;
  if (local.x < -0.02 || local.y < -0.02 || local.x > g.z + 0.02 || local.y > g.z + 0.02) return 0.0;
  vec2 d = abs(fract(local + 0.5) - 0.5) / fwidth(local);
  return 1.0 - min(min(d.x, d.y) / 1.3, 1.0);
}

// Distance from p to the edge of a lagoon (board plus a 1-unit margin); large outside it.
float edgeDist(vec2 p, vec4 g) {
  vec2 lo = g.xy - 1.0;
  vec2 hi = g.xy + g.z * g.w + 1.0;
  float d = min(min(p.x - lo.x, hi.x - p.x), min(p.y - lo.y, hi.y - p.y));
  return d < 0.0 ? 1000.0 : d;
}

void main() {
  vec2 p = vWorld.xz;
  vec2 slope = waveSlope(p, time) + rippleSlope(p, time);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPos - vWorld);
  vec3 l = normalize(-sunDir);

  float edge = min(edgeDist(p, gridHome), edgeDist(p, gridEnemy));
  float shallow = 1.0 - smoothstep(0.0, 24.0, edge);
  vec3 body = mix(deepColor, shallowColor, 0.2 + shallow * 0.75);
  body *= 0.78 + 0.32 * max(dot(n, l), 0.0);

  // Wavy caustic light on the lagoon floor.
  float c1 = noise(p * 0.13 + vec2(time * 0.12, time * 0.05));
  float c2 = noise(p * 0.21 - vec2(time * 0.07, time * 0.11));
  float caust = pow(1.0 - abs((c1 + c2) - 1.0), 7.0);
  body += vec3(0.65, 0.97, 1.0) * caust * 0.13;

  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(skyHorizon, skyTop, clamp(r.y * 1.4, 0.0, 1.0));
  vec3 col = mix(body, sky, fresnel * 0.45);
  vec3 h = normalize(l + v);
  col += sunColor * (pow(max(dot(n, h), 0.0), 500.0) * 1.0 + pow(max(dot(n, h), 0.0), 40.0) * 0.06);

  // Foam lapping at the rocks.
  float wob = noise(p * 0.45 + time * 0.6) * 1.8 + noise(p * 1.3 - time * 0.9) * 0.8;
  float foam = 1.0 - smoothstep(0.4, 1.6 + wob, edge);
  col = mix(col, foamColor, foam * 0.9);

  float g = max(gridLines(p, gridHome), gridLines(p, gridEnemy));
  col = mix(col, vec3(1.0), g * gridAlpha);

  float dist = length(cameraPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * fogDensity, 2.0));
  gl_FragColor = vec4(mix(col, fogColor, clamp(fog, 0.0, 1.0)), 1.0);
}
`;

export interface Sea {
  water: Mesh[];
  /** 0..1, how strongly the grid lines show. */
  setGridEmphasis(v: number): void;
  update(time: number, cameraPos: Vector3): void;
}

export function createSea(scene: Scene): Sea {
  scene.clearColor = new Color4(SKY_HORIZON.r, SKY_HORIZON.g, SKY_HORIZON.b, 1);
  scene.fogMode = 2; // FOGMODE_EXP2
  scene.fogDensity = FOG_DENSITY;
  scene.fogColor = FOG;

  createSky(scene);
  const clouds = createClouds(scene);

  Effect.ShadersStore['tideWaterVertexShader'] = WATER_VERTEX;
  Effect.ShadersStore['tideWaterFragmentShader'] = WATER_FRAGMENT;
  const waterMat = new ShaderMaterial(
    'water',
    scene,
    { vertex: 'tideWater', fragment: 'tideWater' },
    {
      attributes: ['position'],
      uniforms: [
        'world', 'viewProjection', 'time', 'cameraPos', 'deepColor', 'shallowColor', 'skyTop', 'skyHorizon',
        'foamColor', 'fogColor', 'fogDensity', 'sunDir', 'sunColor', 'gridHome', 'gridEnemy', 'gridAlpha',
      ],
    },
  );
  waterMat.setColor3('deepColor', Color3.FromHexString('#0d68c0'));
  waterMat.setColor3('shallowColor', Color3.FromHexString('#25c6e6'));
  waterMat.setColor3('skyTop', SKY_MID);
  waterMat.setColor3('skyHorizon', SKY_HORIZON);
  waterMat.setColor3('foamColor', Color3.FromHexString('#f2fdff'));
  waterMat.setColor3('fogColor', FOG);
  waterMat.setFloat('fogDensity', FOG_DENSITY);
  waterMat.setVector3('sunDir', SUN_DIR);
  waterMat.setColor3('sunColor', new Color3(1, 0.96, 0.86));
  const grid = (side: Side) => new Vector4(GRID_ORIGIN[side].x0, GRID_ORIGIN[side].z0, GRID_SIZE, CELL);
  waterMat.setVector4('gridHome', grid('home'));
  waterMat.setVector4('gridEnemy', grid('enemy'));
  waterMat.setFloat('gridAlpha', 0.3);

  const water: Mesh[] = [];
  const falls: Texture[] = [];
  const floaters: { node: Mesh; y: number; phase: number }[] = [];
  for (const side of ['home', 'enemy'] as const) {
    const { x0, z0 } = GRID_ORIGIN[side];
    const lagoon = MeshBuilder.CreateGround(`water-${side}`, { width: BOARD_SPAN + 2, height: BOARD_SPAN + 2, subdivisions: 64 }, scene);
    lagoon.position.set(x0 + BOARD_SPAN / 2, 0, z0 + BOARD_SPAN / 2);
    lagoon.material = waterMat;
    lagoon.isPickable = false;
    water.push(lagoon);
    const built = createIsland(scene, side, side === 'home' ? 11 : 23);
    falls.push(built.fallTexture);
    floaters.push(...built.floaters);
    createLabels(scene, side);
  }

  return {
    water,
    setGridEmphasis(v) {
      waterMat.setFloat('gridAlpha', 0.16 + 0.34 * v);
    },
    update(time, cameraPos) {
      waterMat.setFloat('time', time);
      waterMat.setVector3('cameraPos', cameraPos);
      for (const t of falls) t.vOffset = -time * 0.9;
      for (const f of floaters) f.node.position.y = f.y + Math.sin(time * 0.6 + f.phase) * 1.2;
      for (const c of clouds) c.node.position.x = c.x + Math.sin(time * 0.03 + c.phase) * 12;
    },
  };
}

// ------------------------------------------------------------------ sky and clouds

function createSky(scene: Scene): void {
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 3000, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
  const sunGlow = new Color3(1, 0.97, 0.88);
  const sunVec = SUN_DIR.scale(-1);
  const positions = sky.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const p = new Vector3(positions[i]!, positions[i + 1]!, positions[i + 2]!).normalize();
    let c: Color3;
    if (p.y >= 0) {
      const t = Math.min(p.y * 1.6, 1);
      c = t < 0.35 ? Color3.Lerp(SKY_HORIZON, SKY_MID, t / 0.35) : Color3.Lerp(SKY_MID, SKY_TOP, (t - 0.35) / 0.65);
    } else {
      c = Color3.Lerp(SKY_HORIZON, SKY_BELOW, Math.min(-p.y * 3, 1));
    }
    const s = Math.max(Vector3.Dot(p, sunVec), 0);
    c = Color3.Lerp(c, sunGlow, Math.pow(s, 10) * 0.6);
    colors.push(c.r, c.g, c.b, 1);
  }
  sky.setVerticesData(VertexBuffer.ColorKind, colors);
  const m = new StandardMaterial('sky', scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.White();
  m.fogEnabled = false;
  sky.material = m;
  sky.isPickable = false;
  sky.infiniteDistance = true;
}

/** A painterly cumulus puff: white tops, blue-grey bellies. */
function cloudTexture(scene: Scene, seed: number): DynamicTexture {
  const W = 256;
  const H = 160;
  const tex = new DynamicTexture(`cloud-tex-${seed}`, { width: W, height: H }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, W, H);
  const rng = createRng(seed);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 11; i++) {
    const x = 50 + rng.next() * 156;
    const r = 18 + rng.next() * 26 * (1 - Math.abs(x - 128) / 160);
    const y = 112 - r * (0.6 + rng.next() * 0.5);
    puffs.push([x, y, r]);
  }
  ctx.fillStyle = '#ffffff';
  for (const [x, y, r] of puffs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(40, 100, 176, 16);
  // Shade the belly and soften the base.
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 30, 0, 118);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(225,238,255,0.25)');
  g.addColorStop(1, 'rgba(170,200,245,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, 104, 0, 120);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 100, W, 60);
  ctx.globalCompositeOperation = 'source-over';
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

function createClouds(scene: Scene): { node: Mesh; x: number; phase: number }[] {
  const mats = [1, 2, 3, 4].map((seed) => {
    const tex = cloudTexture(scene, seed * 31);
    const m = new StandardMaterial(`cloud-mat-${seed}`, scene);
    m.diffuseTexture = tex;
    m.opacityTexture = tex;
    m.emissiveColor = Color3.White();
    m.disableLighting = true;
    m.fogEnabled = false;
    m.backFaceCulling = false;
    return m;
  });
  const rng = createRng(77);
  const out: { node: Mesh; x: number; phase: number }[] = [];
  const add = (x: number, y: number, z: number, w: number, mode: number) => {
    const c = MeshBuilder.CreatePlane(`cloud-${out.length}`, { width: w, height: w * 0.62 }, scene);
    c.material = mats[out.length % mats.length]!;
    c.position.set(x, y, z);
    c.billboardMode = mode;
    c.isPickable = false;
    out.push({ node: c, x, phase: rng.next() * 6.28 });
  };
  // A sea of clouds far below the islands.
  for (let i = 0; i < 30; i++) {
    const x = (rng.next() - 0.5) * 1100;
    const z = -320 + rng.next() * 900;
    add(x, -110 - rng.next() * 50, z, 120 + rng.next() * 140, Mesh.BILLBOARDMODE_ALL);
  }
  // Big towers behind and beside the islands.
  for (let i = 0; i < 10; i++) {
    const a = -0.3 + (i / 9) * (Math.PI + 0.6);
    const d = 420 + rng.next() * 260;
    add(Math.cos(a) * d, -60 + rng.next() * 90, 160 + Math.sin(a) * d, 180 + rng.next() * 140, Mesh.BILLBOARDMODE_Y);
  }
  // A few small puffs drifting near the islands, clear of the boards.
  const near: [number, number, number][] = [
    [-215, 10, 60], [210, -5, 40], [0, 30, 150], [-120, 35, 175], [140, 25, 165], [-230, -30, -60], [235, -25, -80],
  ];
  for (const [x, y, z] of near) add(x, y, z, 50 + rng.next() * 40, Mesh.BILLBOARDMODE_ALL);
  return out;
}

// ------------------------------------------------------------------ islands

const GRASS = Color3.FromHexString('#86c43f');
const GRASS_DARK = Color3.FromHexString('#4f9a3a');
const ROCK_LIT = Color3.FromHexString('#d49b64');
const ROCK = Color3.FromHexString('#a8724f');
const ROCK_DEEP = Color3.FromHexString('#4a5fae');

interface Rng {
  next(): number;
}

/** A chunky rock block: a squarish superellipsoid with jittered, flat-shaded faces. */
function rockBlock(scene: Scene, rng: Rng, w: number, h: number, d: number, at: Vector3, grassTop: number): Mesh {
  const m = MeshBuilder.CreateSphere('rock', { diameter: 2, segments: 5 }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const jitter = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i]!.toFixed(3)},${pos[i + 1]!.toFixed(3)},${pos[i + 2]!.toFixed(3)}`;
    let j = jitter.get(key);
    if (!j) {
      j = [(rng.next() - 0.5) * 0.18, (rng.next() - 0.5) * 0.12, (rng.next() - 0.5) * 0.18];
      jitter.set(key, j);
    }
    const sx = Math.sign(pos[i]!) * Math.pow(Math.abs(pos[i]!), 0.22);
    const sy = Math.sign(pos[i + 1]!) * Math.pow(Math.abs(pos[i + 1]!), 0.22);
    const sz = Math.sign(pos[i + 2]!) * Math.pow(Math.abs(pos[i + 2]!), 0.22);
    // Keep the top flat-ish so boards and labels read; roughen the rest.
    const topFlat = sy > 0.8 ? 0.3 : 1;
    pos[i] = (sx + j[0]) * (w / 2);
    pos[i + 1] = (sy + j[1] * topFlat) * (h / 2);
    pos[i + 2] = (sz + j[2]) * (d / 2);
  }
  m.setVerticesData(VertexBuffer.PositionKind, pos);
  m.position.copyFrom(at);
  m.convertToFlatShadedMesh();
  // Paint by face: grass on top (and a fringe hanging over the edge), warm rock that cools with depth.
  const p2 = m.getVerticesData(VertexBuffer.PositionKind)!;
  const n2 = m.getVerticesData(VertexBuffer.NormalKind)!;
  const cols: number[] = [];
  const tint = 0.9 + rng.next() * 0.2;
  for (let i = 0; i < p2.length; i += 3) {
    const wy = p2[i + 1]! + at.y;
    const ny = n2[i + 1]!;
    let c: Color3;
    if (ny > 0.55 && wy > grassTop - 3) c = Color3.Lerp(GRASS, GRASS_DARK, rng.next() * 0.35);
    else if (wy > grassTop - 1.4 && ny > -0.3) c = GRASS_DARK;
    else {
      const lit = Math.max(0, n2[i]! * -SUN_DIR.x + n2[i + 2]! * -SUN_DIR.z);
      c = Color3.Lerp(ROCK, ROCK_LIT, Math.min(lit * 1.4, 1)).scale(tint);
      c = Color3.Lerp(c, ROCK_DEEP, Math.min(Math.max((-wy - 6) / 60, 0), 0.85));
    }
    const lin = c.toLinearSpace();
    cols.push(lin.r, lin.g, lin.b, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
  return m;
}

function islandMaterial(scene: Scene): PBRMaterial {
  const existing = scene.getMaterialByName('island-mat') as PBRMaterial | null;
  if (existing) return existing;
  const mat = new PBRMaterial('island-mat', scene);
  mat.albedoColor = Color3.White();
  mat.metallic = 0;
  mat.roughness = 0.9;
  return mat;
}

/** A painterly tree: a curving tube trunk with branches and clumps of flat-shaded leaves. */
function tree(scene: Scene, rng: Rng, base: Vector3, s: number): Mesh {
  const parts: Mesh[] = [];
  const bark = Color3.FromHexString('#6b4632');
  const paint = (m: Mesh, pick: (ny: number) => Color3) => {
    const n = m.getVerticesData(VertexBuffer.NormalKind)!;
    const cols: number[] = [];
    for (let i = 0; i < n.length; i += 3) {
      const c = pick(n[i + 1]!).toLinearSpace();
      cols.push(c.r, c.g, c.b, 1);
    }
    m.setVerticesData(VertexBuffer.ColorKind, cols);
    parts.push(m);
  };
  const lean = (rng.next() - 0.5) * 0.6;
  const trunkPath: Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    trunkPath.push(new Vector3(Math.sin(t * 2.2 + lean) * 2.5 * s * t, t * 16 * s, Math.cos(t * 1.7) * 1.2 * s * t - 1.2 * s * t));
  }
  const trunk = MeshBuilder.CreateTube('trunk', { path: trunkPath, tessellation: 9, cap: Mesh.CAP_END, radiusFunction: (i) => (2.0 - (i / 8) * 1.3) * s }, scene);
  paint(trunk, () => bark);
  const top = trunkPath[8]!;
  const crowns: Vector3[] = [top.add(new Vector3(0, 4 * s, 0))];
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + rng.next() * 0.8;
    const from = trunkPath[5 + (b % 3)]!;
    const to = from.add(new Vector3(Math.cos(a) * 9 * s, (2 + rng.next() * 4) * s, Math.sin(a) * 7 * s));
    const mid = Vector3.Lerp(from, to, 0.5).add(new Vector3(0, 1.5 * s, 0));
    const branch = MeshBuilder.CreateTube('branch', { path: [from, mid, to], tessellation: 6, radiusFunction: (i) => (0.9 - i * 0.3) * s }, scene);
    paint(branch, () => bark);
    crowns.push(to);
  }
  const leafTop = Color3.FromHexString('#c6e04f');
  const leafMid = Color3.FromHexString('#7fbf3a');
  const leafLow = Color3.FromHexString('#3f8a3b');
  for (const c of crowns) {
    for (let k = 0; k < 3; k++) {
      const r = (4 + rng.next() * 3.5) * s;
      const leaf = MeshBuilder.CreateIcoSphere('leaf', { radius: r, subdivisions: 2, flat: true }, scene);
      leaf.scaling.y = 0.7;
      leaf.position.copyFrom(c).addInPlaceFromFloats((rng.next() - 0.5) * 6 * s, (rng.next() - 0.2) * 3 * s, (rng.next() - 0.5) * 6 * s);
      leaf.bakeCurrentTransformIntoVertices();
      paint(leaf, (ny) => (ny > 0.35 ? Color3.Lerp(leafMid, leafTop, Math.min((ny - 0.35) * 2, 1)) : Color3.Lerp(leafLow, leafMid, (ny + 1) / 1.35)));
    }
  }
  const m = Mesh.MergeMeshes(parts, true, true)!;
  m.position.copyFrom(base);
  m.name = 'tree';
  return m;
}

function bush(scene: Scene, rng: Rng, at: Vector3, r: number): Mesh {
  const m = MeshBuilder.CreateIcoSphere('bush', { radius: r, subdivisions: 1, flat: true }, scene);
  m.scaling.y = 0.75;
  m.position.copyFrom(at);
  m.bakeCurrentTransformIntoVertices();
  const n = m.getVerticesData(VertexBuffer.NormalKind)!;
  const cols: number[] = [];
  const hue = rng.next();
  for (let i = 0; i < n.length; i += 3) {
    const c = Color3.Lerp(Color3.FromHexString('#3f8a3b'), hue > 0.5 ? Color3.FromHexString('#b6d94a') : Color3.FromHexString('#8cc63f'), (n[i + 1]! + 1) / 2).toLinearSpace();
    cols.push(c.r, c.g, c.b, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, cols);
  return m;
}

function fallTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('fall-tex', { width: 64, height: 256 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 256);
  const rng = createRng(5);
  ctx.fillStyle = 'rgba(200,240,255,0.78)';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 60; i++) {
    const x = rng.next() * 64;
    const y = rng.next() * 256;
    const len = 30 + rng.next() * 90;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + rng.next() * 0.5})`;
    ctx.fillRect(x, y, 1.5 + rng.next() * 3, len);
    ctx.fillRect(x, y - 256, 1.5 + rng.next() * 3, len);
  }
  tex.hasAlpha = true;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.update();
  return tex;
}

/** A sheet of water spilling over the rim at `x`, falling down the front cliff. */
function waterfall(scene: Scene, mat: StandardMaterial, x: number, zEdge: number, width: number): Mesh {
  const lip = zEdge - RIM - 5; // past the outer face of the rim
  const prof: [number, number][] = [
    [zEdge + 1.5, 0.25],
    [lip + 1, 0.25],
    [lip - 1.2, -0.8],
    [lip - 2.6, -4.5],
    [lip - 3.8, -15],
    [lip - 4.6, -42],
    [lip - 5, -90],
  ];
  const left = prof.map(([z, y]) => new Vector3(x - width / 2, y, z));
  const right = prof.map(([z, y]) => new Vector3(x + width / 2, y, z));
  const m = MeshBuilder.CreateRibbon('waterfall', { pathArray: [left, right], sideOrientation: Mesh.DOUBLESIDE }, scene);
  // Stretch the streaks down the fall.
  const uv = m.getVerticesData(VertexBuffer.UVKind)!;
  for (let i = 1; i < uv.length; i += 2) uv[i] = uv[i]! * 3;
  m.setVerticesData(VertexBuffer.UVKind, uv);
  m.material = mat;
  m.isPickable = false;
  return m;
}

function createIsland(scene: Scene, side: Side, seed: number): { fallTexture: Texture; floaters: { node: Mesh; y: number; phase: number }[] } {
  const rng = createRng(seed);
  const { x0, z0 } = GRID_ORIGIN[side];
  const S = BOARD_SPAN;
  const cx = x0 + S / 2;
  const cz = z0 + S / 2;
  const blocks: Mesh[] = [];
  const top = (lo: number, hi: number) => lo + rng.next() * (hi - lo);
  // The waterfall notches on the front edge (nearest the camera).
  const notches = side === 'home' ? [x0 + 22, x0 + 74] : [x0 + 30, x0 + 80];

  // Rim of rock all around the lagoon, a little higher at the back.
  const rimSide = (dir: 'front' | 'back' | 'left' | 'right') => {
    const along = S + RIM * 2;
    let t = -along / 2;
    while (t < along / 2 - 2) {
      const len = Math.min(10 + rng.next() * 9, along / 2 - t);
      const mid = t + len / 2;
      const width = RIM + 1 + rng.next() * 4;
      const hTop = dir === 'back' ? top(2.6, 4.2) : top(1.8, 3.0);
      const bottom = -14 - rng.next() * 8;
      const h = hTop - bottom;
      const out = S / 2 + width / 2 - 1;
      let at: Vector3;
      let w: number;
      let d: number;
      if (dir === 'front' || dir === 'back') {
        const z = dir === 'front' ? cz - out : cz + out;
        at = new Vector3(cx + mid, bottom + h / 2, z);
        w = len + 1.5;
        d = width;
        if (dir === 'front') {
          // Low notches let the lagoon spill over.
          const nx = cx + mid;
          const hit = notches.find((n) => Math.abs(n - nx) < len / 2 + 3);
          if (hit !== undefined) {
            const ht = -0.1;
            blocks.push(rockBlock(scene, rng, len + 1.5, ht - bottom, width, new Vector3(nx, bottom + (ht - bottom) / 2, z), ht));
            t += len;
            continue;
          }
        }
      } else {
        const x = dir === 'left' ? cx - out : cx + out;
        at = new Vector3(x, bottom + h / 2, cz + mid);
        w = width;
        d = len + 1.5;
      }
      blocks.push(rockBlock(scene, rng, w, h, d, at, hTop));
      t += len;
    }
  };
  rimSide('front');
  rimSide('back');
  rimSide('left');
  rimSide('right');

  // The body: tiers of rock tapering down into the clouds.
  const tiers: [number, number, number, number][] = [
    // half-extent, top, bottom, blocks per side
    [S / 2 + RIM - 4, -10, -34, 3],
    [S / 2 - 6, -30, -56, 2],
    [S / 2 - 22, -52, -80, 2],
    [12, -76, -104, 1],
  ];
  for (const [half, hi, lo, n] of tiers) {
    const cell = (half * 2) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const bx = cx - half + cell * (i + 0.5) + (rng.next() - 0.5) * 6;
        const bz = cz - half + cell * (j + 0.5) + (rng.next() - 0.5) * 6;
        const bot = lo - rng.next() * 10;
        const tp = hi + rng.next() * 4;
        blocks.push(rockBlock(scene, rng, cell + 4, tp - bot, cell + 4, new Vector3(bx, (tp + bot) / 2, bz), tp));
      }
    }
  }
  // Hanging chunks on the outer faces.
  for (let i = 0; i < 10; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = S / 2 + RIM * 0.4;
    const bx = cx + Math.max(-r, Math.min(r, Math.cos(a) * r * 1.3));
    const bz = cz + Math.max(-r, Math.min(r, Math.sin(a) * r * 1.3));
    const sz = 8 + rng.next() * 10;
    const y = -24 - rng.next() * 26;
    blocks.push(rockBlock(scene, rng, sz, sz * 1.4, sz, new Vector3(bx, y, bz), y + sz * 0.7));
  }

  // Greenery: one big tree in the back outer corner, small trees and bushes on the rim.
  const outer = side === 'home' ? -1 : 1;
  const greens: Mesh[] = [];
  greens.push(tree(scene, rng, new Vector3(cx + outer * (S / 2 + 6), 3.2, cz + S / 2 + 6), 1.25));
  greens.push(tree(scene, rng, new Vector3(cx - outer * (S / 2 + 7), 3.0, cz + S / 2 + 7), 0.6));
  greens.push(tree(scene, rng, new Vector3(cx + outer * (S / 2 + 7), 2.4, cz - S / 2 - 6), 0.5));
  for (let i = 0; i < 16; i++) {
    const edge = rng.next() * 4;
    const u = (rng.next() - 0.5) * (S + RIM);
    const o = S / 2 + 3 + rng.next() * (RIM - 6);
    const p = edge < 1 ? [u, o] : edge < 2 ? [u, -o] : edge < 3 ? [o, u] : [-o, u];
    // Keep the label rows (back edge and inner side) clear.
    if ((edge < 1 || edge >= 3) && o < S / 2 + 10) continue;
    greens.push(bush(scene, rng, new Vector3(cx + p[0]!, 3.2, cz + p[1]!), 1.6 + rng.next() * 2));
  }

  const rock = Mesh.MergeMeshes(blocks, true, true)!;
  rock.name = `island-${side}`;
  rock.material = islandMaterial(scene);
  rock.useVertexColors = true;
  rock.isPickable = false;
  rock.receiveShadows = true;
  const green = Mesh.MergeMeshes(greens, true, true)!;
  green.name = `greens-${side}`;
  green.material = islandMaterial(scene);
  green.useVertexColors = true;
  green.isPickable = false;
  green.receiveShadows = true;
  islandMeshes.push(rock, green);

  // Waterfalls over the front notches.
  const tex = fallTexture(scene);
  const fallMat = new StandardMaterial(`fall-${side}`, scene);
  fallMat.diffuseTexture = tex;
  fallMat.opacityTexture = tex;
  fallMat.emissiveColor = Color3.FromHexString('#d6f3ff');
  fallMat.disableLighting = true;
  fallMat.backFaceCulling = false;
  for (const nx of notches) waterfall(scene, fallMat, nx, z0, 8);
  const tex2 = tex as Texture;

  // Little rocks floating nearby.
  const floaters: { node: Mesh; y: number; phase: number }[] = [];
  const root = new TransformNode(`floaters-${side}`, scene);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.next();
    const r = S / 2 + RIM + 18 + rng.next() * 24;
    const px = cx + Math.cos(a) * r;
    // Stay out of the gap between the islands so shells have a clear sky.
    if (Math.abs(px) < 30) continue;
    const y = -30 + rng.next() * 30;
    const sz = 3 + rng.next() * 5;
    const b = rockBlock(scene, rng, sz, sz * 0.9, sz, new Vector3(0, 0, 0), sz * 0.45);
    b.material = islandMaterial(scene);
    b.useVertexColors = true;
    b.isPickable = false;
    b.position.set(px, y, cz + Math.sin(a) * r);
    b.parent = root;
    floaters.push({ node: b, y, phase: rng.next() * 6.28 });
  }
  return { fallTexture: tex2, floaters };
}

const islandMeshes: Mesh[] = [];
export function islandList(): Mesh[] {
  return islandMeshes;
}

// ------------------------------------------------------------------ labels

function textPlane(scene: Scene, text: string, size: number): Mesh {
  const tex = new DynamicTexture(`label-${text}`, { width: 128, height: 128 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '800 78px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(40,60,30,0.85)';
  ctx.strokeText(text, 64, 70);
  ctx.fillStyle = '#fffbe8';
  ctx.fillText(text, 64, 70);
  tex.update();
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const m = new StandardMaterial(`label-${text}`, scene);
  m.diffuseTexture = tex;
  m.emissiveColor = Color3.White();
  m.disableLighting = true;
  m.useAlphaFromDiffuseTexture = true;
  m.backFaceCulling = false;
  const plane = MeshBuilder.CreatePlane(`label-${text}`, { size }, scene);
  plane.material = m;
  plane.rotation.x = 1.05; // lie back on the rim, tilted toward the viewer
  plane.isPickable = false;
  return plane;
}

/** А–К along the back rim, 1–10 down the left rim, like the paper game. */
function createLabels(scene: Scene, side: Side): void {
  const { x0, z0 } = GRID_ORIGIN[side];
  const span = BOARD_SPAN;
  for (let i = 0; i < GRID_SIZE; i++) {
    const letter = textPlane(scene, COLUMN_LETTERS[i]!, 7);
    letter.position.set(x0 + (i + 0.5) * CELL, 5.2, z0 + span + 5.5);
    const num = textPlane(scene, String(i + 1), 7);
    num.position.set(x0 - 6.5, 5.2, z0 + span - (i + 0.5) * CELL);
  }
}
