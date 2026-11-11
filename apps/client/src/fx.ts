import {
  Color3,
  Color4,
  DynamicTexture,
  type Mesh,
  MeshBuilder,
  ParticleSystem,
  type Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';

interface Effect {
  /** Returns false when finished. */
  tick(dt: number): boolean;
}

interface Burst {
  capacity: number;
  texture: 'soft' | 'smoke';
  additive?: boolean;
  colors: [Color4, Color4, Color4];
  size: [number, number];
  life: [number, number];
  power: [number, number];
  dir: [Vector3, Vector3];
  gravity?: Vector3;
  box?: number;
  grow?: number;
}

/**
 * Particle effects: shells with smoke trails, water columns, fireballs,
 * debris and drifting smoke. Textures are generated, nothing is downloaded.
 */
export class Fx {
  private effects: Effect[] = [];
  private readonly textures: Record<'soft' | 'smoke', DynamicTexture>;
  private readonly shellMat: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.textures = { soft: softTexture(scene, false), smoke: softTexture(scene, true) };
    this.shellMat = new StandardMaterial('shell', scene);
    this.shellMat.emissiveColor = new Color3(1, 0.85, 0.45);
    this.shellMat.disableLighting = true;
  }

  update(dt: number): void {
    // Effects may spawn new effects while ticking; keep those too.
    const current = this.effects;
    this.effects = [];
    const alive = current.filter((e) => e.tick(dt));
    this.effects = alive.concat(this.effects);
  }

  private system(b: Burst, emitter: Vector3 | Mesh): ParticleSystem {
    const ps = new ParticleSystem('fx', b.capacity, this.scene);
    ps.particleTexture = this.textures[b.texture];
    ps.emitter = emitter;
    const box = b.box ?? 0.5;
    ps.minEmitBox = new Vector3(-box, 0, -box);
    ps.maxEmitBox = new Vector3(box, box * 0.5, box);
    ps.color1 = b.colors[0];
    ps.color2 = b.colors[1];
    ps.colorDead = b.colors[2];
    ps.minSize = b.size[0];
    ps.maxSize = b.size[1];
    ps.minLifeTime = b.life[0];
    ps.maxLifeTime = b.life[1];
    ps.minEmitPower = b.power[0];
    ps.maxEmitPower = b.power[1];
    ps.direction1 = b.dir[0];
    ps.direction2 = b.dir[1];
    ps.gravity = b.gravity ?? Vector3.Zero();
    ps.minAngularSpeed = -1.5;
    ps.maxAngularSpeed = 1.5;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.blendMode = b.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 1 / 60;
    if (b.grow) {
      ps.addSizeGradient(0, 1);
      ps.addSizeGradient(1, b.grow);
    }
    return ps;
  }

  /** Emits `count` particles once, then cleans up. */
  private burst(b: Burst, at: Vector3, count: number): void {
    const ps = this.system(b, at.clone());
    ps.manualEmitCount = count;
    ps.targetStopDuration = 0.2;
    ps.disposeOnStop = true;
    ps.start();
  }

  /** A shell flying in an arc from `from` to `to`. Calls `onLand` on impact. */
  shell(from: Vector3, to: Vector3, duration: number, onLand: () => void): Mesh {
    const m = MeshBuilder.CreateSphere('shell', { diameter: 0.9, segments: 8 }, this.scene);
    m.material = this.shellMat;
    m.isPickable = false;
    m.position.copyFrom(from);
    const trail = this.system(
      {
        capacity: 300,
        texture: 'smoke',
        colors: [new Color4(1, 1, 1, 0.55), new Color4(0.85, 0.88, 0.9, 0.45), new Color4(0.7, 0.72, 0.75, 0)],
        size: [0.8, 1.6],
        life: [0.5, 0.9],
        power: [0.1, 0.4],
        dir: [new Vector3(-0.5, 0.5, -0.5), new Vector3(0.5, 1, 0.5)],
        box: 0.1,
        grow: 2.5,
      },
      m,
    );
    trail.emitRate = 140;
    trail.start();
    const apex = Math.max(25, Vector3.Distance(from, to) * 0.28);
    let t = 0;
    this.effects.push({
      tick: (dt) => {
        t += dt;
        const k = Math.min(t / duration, 1);
        Vector3.LerpToRef(from, to, k, m.position);
        m.position.y += Math.sin(Math.PI * k) * apex;
        if (k >= 1) {
          trail.stop();
          trail.emitter = m.position.clone();
          setTimeout(() => trail.dispose(), 1200);
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
    this.burst(
      {
        capacity: 40,
        texture: 'soft',
        additive: true,
        colors: [new Color4(1, 0.9, 0.5, 1), new Color4(1, 0.55, 0.15, 1), new Color4(0.3, 0.1, 0, 0)],
        size: [1.5, 3],
        life: [0.12, 0.25],
        power: [4, 10],
        dir: [new Vector3(-0.4, 0.3, 0.6), new Vector3(0.4, 0.8, 1)],
        box: 0.3,
      },
      pos,
      30,
    );
    this.burst(
      {
        capacity: 30,
        texture: 'smoke',
        colors: [new Color4(0.9, 0.9, 0.9, 0.6), new Color4(0.75, 0.75, 0.78, 0.5), new Color4(0.6, 0.6, 0.62, 0)],
        size: [2, 4],
        life: [1, 1.8],
        power: [1, 3],
        dir: [new Vector3(-0.5, 0.6, -0.2), new Vector3(0.5, 1, 0.8)],
        box: 0.5,
        grow: 2.2,
      },
      pos,
      18,
    );
  }

  /** «мимо»: a tall white water column with falling spray. */
  splash(pos: Vector3): void {
    const at = new Vector3(pos.x, 0.5, pos.z);
    this.burst(
      {
        capacity: 220,
        texture: 'soft',
        colors: [new Color4(1, 1, 1, 0.95), new Color4(0.85, 0.95, 1, 0.85), new Color4(0.8, 0.9, 1, 0)],
        size: [0.8, 2.2],
        life: [0.9, 1.6],
        power: [14, 26],
        dir: [new Vector3(-0.18, 1, -0.18), new Vector3(0.18, 1, 0.18)],
        gravity: new Vector3(0, -30, 0),
        box: 1.2,
      },
      at,
      200,
    );
    this.burst(
      {
        capacity: 80,
        texture: 'smoke',
        colors: [new Color4(1, 1, 1, 0.55), new Color4(0.9, 0.97, 1, 0.4), new Color4(1, 1, 1, 0)],
        size: [3, 6],
        life: [1.2, 2],
        power: [2, 5],
        dir: [new Vector3(-1, 0.2, -1), new Vector3(1, 0.5, 1)],
        box: 1.5,
        grow: 1.8,
      },
      at,
      40,
    );
  }

  /** «ранил» / «убил»: fireball, flying debris and a rising smoke column. */
  explosion(pos: Vector3, big: boolean): void {
    const s = big ? 1.7 : 1;
    const at = pos.add(new Vector3(0, 2, 0));
    this.burst(
      {
        capacity: 160,
        texture: 'soft',
        additive: true,
        colors: [new Color4(1, 0.95, 0.6, 1), new Color4(1, 0.5, 0.1, 1), new Color4(0.4, 0.05, 0, 0)],
        size: [2.5 * s, 5.5 * s],
        life: [0.25, 0.6],
        power: [4 * s, 12 * s],
        dir: [new Vector3(-1, 0.3, -1), new Vector3(1, 1.5, 1)],
        box: 1,
        grow: 1.6,
      },
      at,
      big ? 140 : 70,
    );
    this.burst(
      {
        capacity: 60,
        texture: 'soft',
        colors: [new Color4(0.15, 0.12, 0.1, 1), new Color4(0.3, 0.25, 0.2, 1), new Color4(0.1, 0.1, 0.1, 0)],
        size: [0.4, 0.9],
        life: [0.8, 1.4],
        power: [12, 22],
        dir: [new Vector3(-1, 1.2, -1), new Vector3(1, 2, 1)],
        gravity: new Vector3(0, -32, 0),
        box: 0.5,
      },
      at,
      big ? 50 : 24,
    );
    this.burst(
      {
        capacity: 80,
        texture: 'smoke',
        colors: [new Color4(0.35, 0.33, 0.32, 0.8), new Color4(0.22, 0.21, 0.2, 0.7), new Color4(0.5, 0.5, 0.5, 0)],
        size: [3 * s, 6 * s],
        life: [2, 3.5],
        power: [2, 5],
        dir: [new Vector3(-0.4, 1, -0.4), new Vector3(0.4, 1.6, 0.4)],
        box: 1.2,
        grow: 2.4,
      },
      at,
      big ? 60 : 28,
    );
  }

  /** A fire with a smoke plume that keeps burning until disposed (for hit marks). */
  burning(pos: Vector3): { dispose(): void } {
    const fire = this.system(
      {
        capacity: 60,
        texture: 'soft',
        additive: true,
        colors: [new Color4(1, 0.85, 0.4, 1), new Color4(1, 0.45, 0.1, 0.9), new Color4(0.3, 0.05, 0, 0)],
        size: [1.4, 2.8],
        life: [0.35, 0.7],
        power: [1.5, 3.5],
        dir: [new Vector3(-0.2, 1, -0.2), new Vector3(0.2, 1, 0.2)],
        box: 0.8,
        grow: 0.4,
      },
      pos.clone(),
    );
    fire.emitRate = 45;
    fire.start();
    const smoke = this.system(
      {
        capacity: 70,
        texture: 'smoke',
        colors: [new Color4(0.25, 0.24, 0.24, 0.6), new Color4(0.4, 0.4, 0.42, 0.5), new Color4(0.6, 0.6, 0.62, 0)],
        size: [2.5, 4.5],
        life: [2.5, 4],
        power: [2, 3.5],
        dir: [new Vector3(-0.1, 1, 0.05), new Vector3(0.3, 1, 0.35)],
        box: 0.6,
        grow: 3,
      },
      pos.add(new Vector3(0, 1.5, 0)),
    );
    smoke.emitRate = 14;
    smoke.start();
    return {
      dispose: () => {
        fire.dispose();
        smoke.dispose();
      },
    };
  }
}

/** A soft round sprite; the smoke version is lumpy so puffs don't look like discs. */
function softTexture(scene: Scene, lumpy: boolean): DynamicTexture {
  const t = new DynamicTexture(lumpy ? 'fx-smoke' : 'fx-soft', { width: 64, height: 64 }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 64, 64);
  const blobs = lumpy ? 7 : 1;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const x = 32 + (lumpy ? Math.cos(a) * 9 : 0);
    const y = 32 + (lumpy ? Math.sin(a) * 9 : 0);
    const r = lumpy ? 18 : 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${lumpy ? 0.55 : 1})`);
    g.addColorStop(0.5, `rgba(255,255,255,${lumpy ? 0.3 : 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  t.hasAlpha = true;
  t.update();
  return t;
}
