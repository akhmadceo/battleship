import {
  Color3,
  Color4,
  DynamicTexture,
  Effect,
  type LinesMesh,
  Mesh,
  MeshBuilder,
  type Scene,
  ShaderMaterial,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import { COLUMN_LETTERS, GRID_SIZE, createRng } from '@tidebound/shared';
import { color, mat } from './palette';
import { CELL, GRID_ORIGIN, type Side } from './world';

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
uniform vec3 cameraPos;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform vec3 foamColor;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 sunDir;
varying vec3 vWorld;
varying float vHeight;

void main() {
  // Face normal from screen-space derivatives: one flat normal per triangle = low-poly facets.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  float diffuse = clamp(dot(n, normalize(sunDir)), 0.0, 1.0);
  float crest = smoothstep(0.55, 1.05, vHeight);
  vec3 base = mix(deepColor, shallowColor, clamp(vHeight * 0.5 + 0.5, 0.0, 1.0));
  vec3 col = base * (0.55 + 0.6 * diffuse);
  col = mix(col, foamColor, crest * 0.55);
  // Soft glint.
  vec3 viewDir = normalize(cameraPos - vWorld);
  float spec = pow(max(dot(reflect(-normalize(sunDir), n), viewDir), 0.0), 24.0);
  col += spec * 0.25;
  float dist = length(cameraPos - vWorld);
  float fog = 1.0 - exp(-pow(dist * fogDensity, 2.0));
  gl_FragColor = vec4(mix(col, fogColor, clamp(fog, 0.0, 1.0)), 1.0);
}
`;

export interface Sea {
  water: Mesh;
  grids: Record<Side, LinesMesh>;
  /** 0..1, how strongly the grid lines show. */
  setGridEmphasis(v: number): void;
  update(time: number, cameraPos: Vector3): void;
}

export const FOG_DENSITY = 0.0016;

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
        'world',
        'viewProjection',
        'time',
        'cameraPos',
        'deepColor',
        'shallowColor',
        'foamColor',
        'fogColor',
        'fogDensity',
        'sunDir',
      ],
    },
  );
  waterMat.setColor3('deepColor', color('seaDeep'));
  waterMat.setColor3('shallowColor', color('seaShallow'));
  waterMat.setColor3('foamColor', color('foam'));
  waterMat.setColor3('fogColor', skyHorizon);
  waterMat.setFloat('fogDensity', FOG_DENSITY);
  waterMat.setVector3('sunDir', new Vector3(0.4, 0.8, 0.3));

  const water = MeshBuilder.CreateGround('water', { width: 900, height: 900, subdivisions: 150 }, scene);
  water.material = waterMat;
  water.isPickable = false;

  const grids = { home: createGrid(scene, 'home'), enemy: createGrid(scene, 'enemy') };
  createLabels(scene, 'home');
  createLabels(scene, 'enemy');
  createIslands(scene);

  return {
    water,
    grids,
    setGridEmphasis(v) {
      for (const g of Object.values(grids)) g.alpha = 0.18 + 0.5 * v;
    },
    update(time, cameraPos) {
      waterMat.setFloat('time', time);
      waterMat.setVector3('cameraPos', cameraPos);
    },
  };
}

function createSky(scene: Scene): void {
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
  const top = color('skyTop');
  const horizon = color('skyHorizon');
  const positions = sky.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]! / 900;
    const t = Math.min(Math.max(y * 2.2, 0), 1);
    const c = Color3.Lerp(horizon, top, t);
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

function createGrid(scene: Scene, side: Side): LinesMesh {
  const { x0, z0 } = GRID_ORIGIN[side];
  const span = GRID_SIZE * CELL;
  const lines: Vector3[][] = [];
  const y = 1.1;
  for (let i = 0; i <= GRID_SIZE; i++) {
    lines.push([new Vector3(x0 + i * CELL, y, z0), new Vector3(x0 + i * CELL, y, z0 + span)]);
    lines.push([new Vector3(x0, y, z0 + i * CELL), new Vector3(x0 + span, y, z0 + i * CELL)]);
  }
  const grid = MeshBuilder.CreateLineSystem(`grid-${side}`, { lines }, scene);
  grid.color = side === 'enemy' ? new Color3(1, 0.93, 0.85) : new Color3(0.85, 0.95, 1);
  grid.alpha = 0.3;
  grid.isPickable = false;
  return grid;
}

function textPlane(scene: Scene, text: string, size: number): Mesh {
  const tex = new DynamicTexture(`label-${text}`, { width: 128, height: 128 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(text, 64, 70);
  tex.update();
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
    letter.position.set(x0 + (i + 0.5) * CELL, 1.6, letterZ);
    const num = textPlane(scene, String(i + 1), 7);
    num.position.set(x0 - CELL * 0.6, 1.6, z0 + (i + 0.5) * CELL);
  }
}

/** Jittered, flat-shaded rock. */
function lump(scene: Scene, name: string, radius: number, flatten: number, seed: number): Mesh {
  const rng = createRng(seed);
  const m = MeshBuilder.CreateIcoSphere(name, { radius, subdivisions: 1, flat: true }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  // Jitter by original position so shared corners move together and faces stay closed.
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i]!.toFixed(3)},${pos[i + 1]!.toFixed(3)},${pos[i + 2]!.toFixed(3)}`;
    let j = jitter.get(key);
    if (j === undefined) {
      j = 0.8 + rng.next() * 0.4;
      jitter.set(key, j);
    }
    pos[i] = pos[i]! * j;
    pos[i + 1] = Math.max(pos[i + 1]! * j * flatten, -radius * 0.2);
    pos[i + 2] = pos[i + 2]! * j;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  m.convertToFlatShadedMesh();
  return m;
}

function createIslands(scene: Scene): void {
  const rng = createRng(20261110);
  const spots: [number, number, number][] = [
    // x, z, radius: a frame of islands around the play area, clear of both grids.
    [-115, 0, 22],
    [118, 8, 18],
    [-150, -140, 34],
    [160, -110, 28],
    [-170, 140, 38],
    [150, 170, 30],
    [20, 230, 45],
    [-60, -250, 40],
    [95, -235, 26],
  ];
  spots.forEach(([x, z, r], i) => {
    const beach = lump(scene, `beach-${i}`, r, 0.18, 100 + i);
    beach.material = mat(scene, 'sand');
    beach.position.set(x, 0, z);
    const hill = lump(scene, `hill-${i}`, r * 0.7, 0.5 + rng.next() * 0.4, 200 + i);
    hill.material = mat(scene, i % 2 ? 'grass' : 'grassDark');
    hill.position.set(x + (rng.next() - 0.5) * r * 0.3, 1.5, z + (rng.next() - 0.5) * r * 0.3);
    if (r > 25) {
      const rock = lump(scene, `rock-${i}`, r * 0.3, 1.2, 300 + i);
      rock.material = mat(scene, 'rock');
      rock.position.set(x + r * 0.35, 3, z - r * 0.2);
    }
    for (const m of [beach, hill]) m.isPickable = false;
  });
}
