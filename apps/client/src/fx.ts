import { type Mesh, MeshBuilder, type Scene, Vector3 } from '@babylonjs/core';
import { mat, type PaletteKey } from './palette';

interface Effect {
  /** Returns false when finished. */
  tick(dt: number): boolean;
}

/**
 * Short-lived low-poly effects: shells, splashes, explosions, smoke puffs.
 * All shapes are tiny flat-shaded meshes animated on the CPU, no textures.
 */
export class Fx {
  private effects: Effect[] = [];

  constructor(private readonly scene: Scene) {}

  update(dt: number): void {
    // Effects may spawn new effects while ticking; keep those too.
    const current = this.effects;
    this.effects = [];
    const alive = current.filter((e) => e.tick(dt));
    this.effects = alive.concat(this.effects);
  }

  get busy(): boolean {
    return this.effects.length > 0;
  }

  private puff(key: PaletteKey, pos: Vector3, radius: number, life: number, rise: number, grow: number, emissive = 0): void {
    const m = MeshBuilder.CreateIcoSphere('puff', { radius, subdivisions: 1, flat: true }, this.scene);
    m.material = mat(this.scene, key, { emissive });
    m.position.copyFrom(pos);
    m.isPickable = false;
    let t = 0;
    this.effects.push({
      tick: (dt) => {
        t += dt;
        const k = t / life;
        if (k >= 1) {
          m.dispose();
          return false;
        }
        m.position.y += rise * dt;
        m.scaling.setAll(1 + grow * k);
        m.visibility = 1 - k * k;
        return true;
      },
    });
  }

  /**
   * A shell flying in an arc from `from` to `to`. Calls `onLand` on impact.
   * Returns the shell mesh so the camera can follow it.
   */
  shell(from: Vector3, to: Vector3, duration: number, onLand: () => void): Mesh {
    const m = MeshBuilder.CreateIcoSphere('shell', { radius: 0.8, subdivisions: 1, flat: true }, this.scene);
    m.material = mat(this.scene, 'fireCore', { emissive: 0.8 });
    m.isPickable = false;
    const apex = Math.max(25, Vector3.Distance(from, to) * 0.28);
    let t = 0;
    let trail = 0;
    this.effects.push({
      tick: (dt) => {
        t += dt;
        const k = Math.min(t / duration, 1);
        Vector3.LerpToRef(from, to, k, m.position);
        m.position.y += Math.sin(Math.PI * k) * apex;
        trail += dt;
        if (trail > 0.05) {
          trail = 0;
          this.puff('trail', m.position, 0.5, 0.45, 0.5, 1.2, 0.3);
        }
        if (k >= 1) {
          m.dispose();
          onLand();
          return false;
        }
        return true;
      },
    });
    return m;
  }

  muzzle(pos: Vector3): void {
    this.puff('fireCore', pos, 1.4, 0.25, 0, 1.5, 0.9);
    for (let i = 0; i < 3; i++) this.puff('smoke', pos.add(new Vector3(0, i * 0.8, 0)), 1.2, 1.1, 3, 2);
  }

  /** «мимо»: a white column and a ring of droplets. */
  splash(pos: Vector3): void {
    const col = MeshBuilder.CreateCylinder('splash', { diameterTop: 0.6, diameterBottom: 4, height: 10, tessellation: 7 }, this.scene);
    col.convertToFlatShadedMesh();
    col.material = mat(this.scene, 'splash', { emissive: 0.3 });
    col.isPickable = false;
    col.position.set(pos.x, 0, pos.z);
    let t = 0;
    const life = 1.1;
    this.effects.push({
      tick: (dt) => {
        t += dt;
        const k = t / life;
        if (k >= 1) {
          col.dispose();
          return false;
        }
        const rise = Math.sin(Math.min(k * 1.6, 1) * Math.PI * 0.5);
        col.scaling.set(1 + k * 0.6, Math.max(0.05, rise * (1 - k * 0.7)), 1 + k * 0.6);
        col.position.y = (10 * col.scaling.y) / 2;
        col.visibility = 1 - k;
        return true;
      },
    });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.puff('splash', pos.add(new Vector3(Math.cos(a) * 3, 0.5, Math.sin(a) * 3)), 0.9, 0.7, 2, 1.2, 0.3);
    }
  }

  /** «ранил» / «убил»: fireball, debris and smoke. */
  explosion(pos: Vector3, big: boolean): void {
    const s = big ? 1.8 : 1;
    this.puff('fireCore', pos.add(new Vector3(0, 2, 0)), 2.5 * s, 0.35, 2, 2.2, 1);
    this.puff('fire', pos.add(new Vector3(0, 2, 0)), 3.5 * s, 0.6, 4, 1.8, 0.7);
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const off = new Vector3((Math.random() - 0.5) * 6 * s, 1 + Math.random() * 3, (Math.random() - 0.5) * 6 * s);
      this.puff('smoke', pos.add(off), 1.8 * s, 1.6 + Math.random(), 5, 2.5);
    }
  }

  /** A flame that keeps burning until disposed (for hit marks). */
  burning(pos: Vector3): { dispose(): void } {
    let alive = true;
    let t = Math.random();
    this.effects.push({
      tick: (dt) => {
        if (!alive) return false;
        t += dt;
        if (t > 0.18) {
          t = 0;
          const jitter = new Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
          this.puff('fire', pos.add(jitter), 0.9, 0.5, 4, 0.6, 0.8);
          if (Math.random() < 0.5) this.puff('smoke', pos.add(jitter).add(new Vector3(0, 2, 0)), 1.1, 1.6, 4, 2);
        }
        return true;
      },
    });
    return { dispose: () => (alive = false) };
  }
}
