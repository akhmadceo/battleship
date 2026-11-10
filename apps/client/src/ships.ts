import { Mesh, MeshBuilder, type Scene, TransformNode, VertexData } from '@babylonjs/core';
import { type ShipClass, SHIP_CLASSES } from '@tidebound/shared';
import { mat, type PaletteKey } from './palette';
import { CELL } from './world';

export type Team = 'blue' | 'red';

export const CLASS_NAMES: Record<ShipClass, string> = {
  ironclad: 'Ironclad',
  corvette: 'Corvette',
  cutter: 'Cutter',
  skiff: 'Skiff',
};

/**
 * A closed, flat-shaded hull: deck outline at yTop, a narrower keel outline at
 * yBottom, both convex polygons listed counter-clockwise seen from above.
 */
function hull(scene: Scene, name: string, deck: [number, number][], keel: [number, number][], yTop: number, yBottom: number): Mesh {
  const n = deck.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const push = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const top = deck.map(([x, z]) => push(x, yTop, z));
  const bottom = keel.map(([x, z]) => push(x, yBottom, z));
  for (let i = 1; i < n - 1; i++) indices.push(top[0]!, top[i + 1]!, top[i]!);
  for (let i = 1; i < n - 1; i++) indices.push(bottom[0]!, bottom[i]!, bottom[i + 1]!);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(top[i]!, top[j]!, bottom[j]!, top[i]!, bottom[j]!, bottom[i]!);
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  // Same attribute set as the builder parts, so they can be merged.
  vd.uvs = new Array((positions.length / 3) * 2).fill(0);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(m);
  m.convertToFlatShadedMesh();
  return m;
}

function box(scene: Scene, w: number, h: number, d: number, x: number, y: number, z: number, key: PaletteKey): Mesh {
  const b = MeshBuilder.CreateBox('part', { width: w, height: h, depth: d }, scene);
  b.position.set(x, y + h / 2, z);
  b.material = mat(scene, key);
  return b;
}

function cyl(scene: Scene, dTop: number, dBottom: number, h: number, tess: number, x: number, y: number, z: number, key: PaletteKey): Mesh {
  const c = MeshBuilder.CreateCylinder('part', { diameterTop: dTop, diameterBottom: dBottom, height: h, tessellation: tess }, scene);
  c.convertToFlatShadedMesh();
  c.position.set(x, y + h / 2, z);
  c.material = mat(scene, key);
  return c;
}

function turret(scene: Scene, x: number, y: number, z: number, facing: 1 | -1): Mesh[] {
  const base = cyl(scene, 3.2, 3.6, 1.2, 6, x, y, z, 'steel');
  const barrel = box(scene, 0.5, 0.5, 3.6, x, y + 0.6, z + facing * 2.2, 'steelDark');
  return [base, barrel];
}

/**
 * Builds an original low-poly ship for a class, bow along local +z, waterline at y = 0.
 * Returns a root node so callers can move, bob and tilt it.
 */
export function buildShip(scene: Scene, cls: ShipClass, team: Team, name: string): TransformNode {
  const size = SHIP_CLASSES[cls].size;
  const L = size * CELL * 0.86;
  const B = cls === 'skiff' ? 3.6 : cls === 'cutter' ? 4.4 : cls === 'corvette' ? 5.4 : 6.6;
  const hullKey: PaletteKey = team === 'blue' ? 'blueHull' : 'redHull';
  const accent: PaletteKey = team === 'blue' ? 'blueAccent' : 'redAccent';
  const bowStart = L / 2 - B * 0.9;

  const parts: Mesh[] = [];
  const h = hull(
    scene,
    'hull',
    [[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, bowStart], [0, L / 2], [-B / 2, bowStart]].reverse() as [number, number][],
    [[-B * 0.3, -L * 0.46], [B * 0.3, -L * 0.46], [B * 0.3, bowStart * 0.9], [0, L * 0.47], [-B * 0.3, bowStart * 0.9]].reverse() as [number, number][],
    1.6,
    -1.4,
  );
  h.material = mat(scene, hullKey);
  parts.push(h);
  // Deck plate.
  parts.push(box(scene, B * 0.86, 0.25, L * 0.8, 0, 1.6, -L * 0.06, 'deck'));
  // Accent stripe along the waterline.
  parts.push(box(scene, B * 1.02, 0.35, L * 0.7, 0, 0.35, -L * 0.1, accent));

  const deckY = 1.85;
  switch (cls) {
    case 'ironclad': {
      parts.push(box(scene, B * 0.6, 3.2, L * 0.22, 0, deckY, -L * 0.02, 'steel'));
      parts.push(box(scene, B * 0.42, 1.8, L * 0.12, 0, deckY + 3.2, 0, 'steel'));
      parts.push(cyl(scene, 1.6, 2.0, 4.2, 6, 0, deckY + 2.4, -L * 0.17, accent));
      parts.push(box(scene, 0.3, 6, 0.3, 0, deckY + 5, L * 0.04, 'steelDark'));
      parts.push(...turret(scene, 0, deckY, L * 0.27, 1));
      parts.push(...turret(scene, 0, deckY, L * 0.15, 1));
      parts.push(...turret(scene, 0, deckY, -L * 0.33, -1));
      break;
    }
    case 'corvette': {
      parts.push(box(scene, B * 0.6, 2.8, L * 0.26, 0, deckY, -L * 0.05, 'steel'));
      parts.push(cyl(scene, 1.4, 1.7, 3.4, 6, 0, deckY + 2, -L * 0.2, accent));
      parts.push(box(scene, 0.3, 5, 0.3, 0, deckY + 4, 0, 'steelDark'));
      parts.push(...turret(scene, 0, deckY, L * 0.24, 1));
      parts.push(...turret(scene, 0, deckY, -L * 0.33, -1));
      break;
    }
    case 'cutter': {
      parts.push(box(scene, B * 0.62, 2.4, L * 0.3, 0, deckY, -L * 0.08, 'steel'));
      parts.push(cyl(scene, 1.2, 1.4, 2.6, 6, 0, deckY + 1.6, -L * 0.24, accent));
      parts.push(...turret(scene, 0, deckY, L * 0.22, 1));
      break;
    }
    case 'skiff': {
      parts.push(box(scene, B * 0.66, 1.8, L * 0.32, 0, deckY, -L * 0.1, 'steel'));
      parts.push(box(scene, 0.25, 3, 0.25, 0, deckY + 1.8, -L * 0.1, 'steelDark'));
      parts.push(box(scene, B * 0.3, 0.6, 1.6, 0, deckY, L * 0.22, accent));
      break;
    }
  }

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  merged.name = `${name}-mesh`;
  merged.isPickable = false;
  const root = new TransformNode(name, scene);
  merged.parent = root;
  return root;
}

/** Makes a ghost copy for showing a planned move. */
export function ghostOf(scene: Scene, source: TransformNode, name: string): TransformNode {
  const root = new TransformNode(name, scene);
  for (const child of source.getChildMeshes(true)) {
    const clone = (child as Mesh).clone(`${name}-mesh`, root);
    if (clone) {
      clone.material = mat(scene, 'move', { emissive: 0.6, alpha: 0.35 });
      clone.isPickable = false;
    }
  }
  root.setEnabled(false);
  return root;
}
