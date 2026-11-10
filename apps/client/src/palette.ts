import { Color3, type Scene, StandardMaterial } from '@babylonjs/core';

/** The whole game's colours. One small palette keeps the low-poly look coherent. */
export const PALETTE = {
  skyTop: '#5fb4d9',
  skyHorizon: '#cfeef2',
  seaDeep: '#11698e',
  seaShallow: '#2fa8b5',
  foam: '#e8fbfa',
  sand: '#e9d29a',
  grass: '#7cbf5a',
  grassDark: '#5a9a45',
  rock: '#8a8577',
  deck: '#d9c296',
  steel: '#c7ccd1',
  steelDark: '#6b737b',
  blueHull: '#2c4a6e',
  blueAccent: '#3fa7f0',
  redHull: '#6e3a2c',
  redAccent: '#f0703f',
  wreck: '#3b3530',
  fire: '#ff8a2a',
  fireCore: '#ffd54a',
  smoke: '#7d8389',
  trail: '#eef3f5',
  splash: '#f4ffff',
  target: '#ff4d4d',
  hover: '#ffe066',
  move: '#7dff9a',
} as const;

export type PaletteKey = keyof typeof PALETTE;

const cache = new Map<string, StandardMaterial>();

/** A flat, matte material for a palette colour (shared, so meshes can batch). */
export function mat(scene: Scene, key: PaletteKey, opts: { emissive?: number; alpha?: number } = {}): StandardMaterial {
  const id = `${key}|${opts.emissive ?? 0}|${opts.alpha ?? 1}`;
  const hit = cache.get(id);
  if (hit && hit.getScene() === scene) return hit;
  const m = new StandardMaterial(`m-${id}`, scene);
  const c = Color3.FromHexString(PALETTE[key]);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  m.emissiveColor = c.scale(opts.emissive ?? 0);
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  cache.set(id, m);
  return m;
}

export function color(key: PaletteKey): Color3 {
  return Color3.FromHexString(PALETTE[key]);
}
