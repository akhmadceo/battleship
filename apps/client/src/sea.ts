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
  Vector3,
  Vector4,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { COLUMN_LETTERS, GRID_SIZE, createRng } from '@tidebound/shared';
import { color } from './palette';
import { CELL, GRID_ORIGIN, type Side } from './world';

/** Direction the sunlight travels (from the sun toward the ground). */
export const SUN_DIR = new Vector3(-0.45, -0.62, -0.64).normalize();

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
  return 0.55 * sin(p.x * 0.045 + t * 0.9)
       + 0.4 * sin(p.y * 0.06 - t * 1.1)
       + 0.25 * sin((p.x + p.y) * 0.11 + t * 1.7);
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
uniform vec4 gridHome;   // x0, z0, size, cell
uniform vec4 gridEnemy;
uniform float gridAlpha;
varying vec3 vWorld;
varying float vHeight;

// Analytic slope of the big waves (same sum as the vertex shader).
vec2 waveSlope(vec2 p, float t) {
  float a = cos(p.x * 0.045 + t * 0.9) * 0.55 * 0.045;
  float b = cos(p.y * 0.06 - t * 1.1) * 0.4 * 0.06;
  float c = cos((p.x + p.y) * 0.11 + t * 1.7) * 0.25 * 0.11;
  return vec2(a + c, b + c);
}

// Small ripples: a few rotated sine layers for detail normals.
vec2 rippleSlope(vec2 p, float t) {
  vec2 s = vec2(0.0);
  s += 0.10 * cos(dot(p, vec2(0.31, 0.18)) * 1.0 + t * 2.1) * vec2(0.31, 0.18);
  s += 0.08 * cos(dot(p, vec2(-0.22, 0.37)) * 1.0 - t * 2.6) * vec2(-0.22, 0.37);
  s += 0.06 * cos(dot(p, vec2(0.61, -0.43)) * 1.0 + t * 3.3) * vec2(0.61, -0.43);
  s += 0.04 * cos(dot(p, vec2(-0.83, -0.71)) * 1.0 + t * 4.1) * vec2(-0.83, -0.71);
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
  float line = 1.0 - min(min(d.x, d.y) / 1.3, 1.0);
  return line;
}

void main() {
  vec2 slope = waveSlope(vWorld.xz, time) + rippleSlope(vWorld.xz, time);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPos - vWorld);
  vec3 l = normalize(-sunDir);

  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(skyHorizon, skyTop, clamp(r.y * 1.6, 0.0, 1.0));

  float facing = clamp(vHeight * 0.45 + 0.55, 0.0, 1.0);
  vec3 body = mix(deepColor, shallowColor, facing * 0.6);
  body *= 0.55 + 0.45 * max(dot(n, l), 0.0);
  // Light scattering through wave crests.
  float sss = pow(max(dot(v, -l), 0.0), 3.0) * clamp(vHeight, 0.0, 1.0);
  body += shallowColor * sss * 0.35;

  vec3 col = mix(body, sky, fresnel * 0.6);
  vec3 h = normalize(l + v);
  col += sunColor * (pow(max(dot(n, h), 0.0), 700.0) * 1.2 + pow(max(dot(n, h), 0.0), 60.0) * 0.05);

  float foamNoise = noise(vWorld.xz * 0.25 + vec2(time * 0.3, -time * 0.2)) * 0.6 + noise(vWorld.xz * 0.9 - time * 0.5) * 0.4;
  float foam = smoothstep(0.95, 1.3, vHeight + foamNoise * 0.3);
  col = mix(col, foamColor, foam * 0.55);

  float g = max(gridLines(vWorld.xz, gridHome), gridLines(vWorld.xz, gridEnemy));
  col = mix(col, vec3(1.0), g * gridAlpha);

  float dist = length(cameraPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * fogDensity, 2.0));
  gl_FragColor = vec4(mix(col, fogColor, clamp(fog, 0.0, 1.0)), 1.0);
}
`;

export interface Sea {
  water: Mesh;
  /** 0..1, how strongly the grid lines show. */
  setGridEmphasis(v: number): void;
  update(time: number, cameraPos: Vector3): void;
}

export const FOG_DENSITY = 0.0011;

export function createSea(scene: Scene): Sea {
  const skyHorizon = color('skyHorizon');
  scene.clearColor = new Color4(skyHorizon.r, skyHorizon.g, skyHorizon.b, 1);
  scene.fogMode = 2; // FOGMODE_EXP2
  scene.fogDensity = FOG_DENSITY;
  scene.fogColor = skyHorizon;

  createSky(scene);

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
  waterMat.setColor3('deepColor', color('seaDeep'));
  waterMat.setColor3('shallowColor', color('seaShallow'));
  waterMat.setColor3('skyTop', color('skyTop'));
  waterMat.setColor3('skyHorizon', skyHorizon);
  waterMat.setColor3('foamColor', color('foam'));
  waterMat.setColor3('fogColor', skyHorizon);
  waterMat.setFloat('fogDensity', FOG_DENSITY);
  waterMat.setVector3('sunDir', SUN_DIR);
  waterMat.setColor3('sunColor', new Color3(1, 0.95, 0.85));
  const grid = (side: Side) => new Vector4(GRID_ORIGIN[side].x0, GRID_ORIGIN[side].z0, GRID_SIZE, CELL);
  waterMat.setVector4('gridHome', grid('home'));
  waterMat.setVector4('gridEnemy', grid('enemy'));
  waterMat.setFloat('gridAlpha', 0.2);

  const water = MeshBuilder.CreateGround('water', { width: 1000, height: 1000, subdivisions: 200 }, scene);
  water.material = waterMat;
  water.isPickable = false;

  createLabels(scene, 'home');
  createLabels(scene, 'enemy');
  createIslands(scene);

  return {
    water,
    setGridEmphasis(v) {
      waterMat.setFloat('gridAlpha', 0.12 + 0.38 * v);
    },
    update(time, cameraPos) {
      waterMat.setFloat('time', time);
      waterMat.setVector3('cameraPos', cameraPos);
    },
  };
}

function createSky(scene: Scene): void {
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 2000, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const top = color('skyTop');
  const horizon = color('skyHorizon');
  const sunGlow = new Color3(1, 0.96, 0.86);
  const sunVec = SUN_DIR.scale(-1);
  const positions = sky.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const p = new Vector3(positions[i]!, positions[i + 1]!, positions[i + 2]!).normalize();
    const t = Math.min(Math.max(p.y * 2.4, 0), 1);
    let c = Color3.Lerp(horizon, top, Math.sqrt(t));
    const s = Math.max(Vector3.Dot(p, sunVec), 0);
    c = Color3.Lerp(c, sunGlow, Math.pow(s, 12) * 0.7);
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

  // Soft clouds: camera-facing sprites with a generated texture, far away.
  const tex = new DynamicTexture('cloud-tex', { width: 256, height: 128 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 128);
  const rng = createRng(77);
  for (let i = 0; i < 14; i++) {
    const x = 70 + rng.next() * 116;
    const y = 70 + (rng.next() - 0.5) * 30;
    const r = 16 + rng.next() * 22;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.hasAlpha = true;
  tex.update();
  const cm = new StandardMaterial('cloud', scene);
  cm.diffuseTexture = tex;
  cm.opacityTexture = tex;
  cm.emissiveColor = new Color3(1, 1, 1);
  cm.disableLighting = true;
  cm.fogEnabled = false;
  cm.backFaceCulling = false;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.next() * 0.4;
    const d = 700 + rng.next() * 150;
    const c = MeshBuilder.CreatePlane(`cloud-${i}`, { width: 260 + rng.next() * 160, height: 90 + rng.next() * 40 }, scene);
    c.material = cm;
    c.position.set(Math.cos(a) * d, 90 + rng.next() * 120, Math.sin(a) * d);
    c.billboardMode = Mesh.BILLBOARDMODE_Y;
    c.isPickable = false;
  }
}

function textPlane(scene: Scene, text: string, size: number): Mesh {
  const tex = new DynamicTexture(`label-${text}`, { width: 128, height: 128 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '600 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,30,50,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
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
  plane.rotation.x = Math.PI / 2;
  plane.isPickable = false;
  return plane;
}

/** А–К along the channel side, 1–10 along the left edge, lying flat on the water. */
function createLabels(scene: Scene, side: Side): void {
  const { x0, z0 } = GRID_ORIGIN[side];
  const span = GRID_SIZE * CELL;
  const letterZ = side === 'enemy' ? z0 - CELL * 0.6 : z0 + span + CELL * 0.6;
  for (let i = 0; i < GRID_SIZE; i++) {
    const letter = textPlane(scene, COLUMN_LETTERS[i]!, 7);
    letter.position.set(x0 + (i + 0.5) * CELL, 1.8, letterZ);
    const num = textPlane(scene, String(i + 1), 7);
    num.position.set(x0 - CELL * 0.6, 1.8, z0 + (i + 0.5) * CELL);
  }
}

/** A smooth, gently noisy island with sand, grass and rock coloured by height. */
function island(scene: Scene, name: string, radius: number, height: number, seed: number): Mesh {
  const rng = createRng(seed);
  const m = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 20 }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const phases = Array.from({ length: 4 }, () => rng.next() * Math.PI * 2);
  const colors: number[] = [];
  const sand = color('sand');
  const grass = color('grass');
  const grassDark = color('grassDark');
  const rock = color('rock');
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    const a = Math.atan2(z, x);
    const wobble = 1 + 0.18 * Math.sin(a * 3 + phases[0]!) + 0.1 * Math.sin(a * 5 + phases[1]!) + 0.06 * Math.sin(a * 9 + phases[2]!);
    const peak = Math.max(y, -0.25);
    const ny = peak > 0 ? Math.pow(peak, 1.25) * height * (0.85 + 0.3 * Math.sin(a * 2 + phases[3]!)) : peak * 6;
    pos[i] = x * radius * wobble;
    pos[i + 1] = ny;
    pos[i + 2] = z * radius * wobble;
    const k = ny / height;
    const c = k < 0.06 ? sand : k < 0.12 ? Color3.Lerp(sand, grass, (k - 0.06) / 0.06) : k < 0.55 ? Color3.Lerp(grass, grassDark, (k - 0.12) / 0.43) : Color3.Lerp(grassDark, rock, Math.min((k - 0.55) / 0.3, 1));
    const lin = c.toLinearSpace();
    colors.push(lin.r, lin.g, lin.b, 1);
  }
  m.setVerticesData(VertexBuffer.PositionKind, pos);
  m.setVerticesData(VertexBuffer.ColorKind, colors);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.setVerticesData(VertexBuffer.NormalKind, normals);
  m.refreshBoundingInfo();
  const mat = new PBRMaterial(`${name}-mat`, scene);
  mat.albedoColor = Color3.White();
  mat.metallic = 0;
  mat.roughness = 0.92;
  m.material = mat;
  m.useVertexColors = true;
  m.isPickable = false;
  return m;
}

const islandMeshes: Mesh[] = [];
export function islandList(): Mesh[] {
  return islandMeshes;
}

function createIslands(scene: Scene): void {
  const spots: [number, number, number, number][] = [
    // x, z, radius, height: a frame of islands around the play area, clear of both grids.
    [-118, 0, 24, 16],
    [120, 8, 19, 12],
    [-160, -140, 38, 30],
    [170, -110, 30, 22],
    [-175, 150, 42, 34],
    [160, 175, 32, 24],
    [20, 240, 50, 40],
    [-60, -260, 44, 28],
    [100, -245, 28, 18],
  ];
  spots.forEach(([x, z, r, h], i) => {
    const m = island(scene, `island-${i}`, r, h, 100 + i);
    m.position.set(x, -0.6, z);
    islandMeshes.push(m);
  });
}
