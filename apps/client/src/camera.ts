import { type Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { GRID_CENTER } from './world';

export type CameraMode = 'chase' | 'aim' | 'tactical';

const ZOOM_DISTANCES = [42, 62, 95];
const MAX_YAW = Math.PI / 3; // ±60°

/**
 * Third-person camera rig. Chase view sits behind and above the active ship
 * looking toward the enemy sea; aim view lifts up to read the grid; tactical
 * view looks straight down over both seas. Every change is a smooth blend.
 */
export class CameraRig {
  readonly camera: UniversalCamera;
  mode: CameraMode = 'chase';
  /** Ship (or point) the camera follows. */
  anchor = new Vector3(0, 0, 0);
  /** Temporary focus during round playback (a flying shell). */
  focus: Vector3 | null = null;

  private yaw = 0;
  private zoom = 1;
  private idle = 0;
  private readonly pos = new Vector3();
  private readonly target = new Vector3();

  constructor(scene: Scene) {
    this.camera = new UniversalCamera('cam', new Vector3(0, 40, -200), scene);
    this.camera.fov = 0.95;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 3000;
    this.camera.inputs.clear();
    this.desired(this.pos, this.target, 1);
    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(this.target);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  toggle(mode: Exclude<CameraMode, 'chase'>): void {
    this.mode = this.mode === mode ? 'chase' : mode;
  }

  orbit(deltaYaw: number): void {
    this.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, this.yaw + deltaYaw));
    this.idle = 0;
  }

  cycleZoom(dir: 1 | -1): void {
    this.zoom = Math.max(0, Math.min(ZOOM_DISTANCES.length - 1, this.zoom + dir));
  }

  private desired(pos: Vector3, target: Vector3, aspect: number): void {
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // Portrait phones see less to the sides, so pull back.
    const dist = ZOOM_DISTANCES[this.zoom]! * (aspect < 1 ? 1.5 : 1);
    if (this.mode === 'tactical') {
      // Fit both seas (z -130..130, x -60..60) with a perspective camera looking almost straight down.
      const half = Math.tan(this.camera.fov / 2);
      const h = Math.max(145 / half, 70 / (half * aspect)) + 10;
      pos.set(0, h, -1);
      target.set(0, 0, 0);
      return;
    }
    if (this.mode === 'aim') {
      // Hover over the channel, high up, looking down the enemy sea from our side.
      const look = GRID_CENTER.enemy;
      const x = this.anchor.x * 0.5 + Math.sin(this.yaw) * 60;
      pos.set(x, 95 + this.zoom * 25, look.z - 115 - this.zoom * 25);
      target.set(look.x + x * 0.2, 0, look.z - 8);
      return;
    }
    pos.copyFrom(this.anchor).addInPlace(forward.scale(-dist)).addInPlace(new Vector3(0, dist * 0.42, 0));
    target.copyFrom(this.anchor).addInPlace(forward.scale(32)).addInPlace(new Vector3(0, 4, 0));
    if (this.focus) Vector3.LerpToRef(target, this.focus, 0.65, target);
  }

  update(dt: number, aspect: number): void {
    this.idle += dt;
    if (this.idle > 2 && this.mode === 'chase') this.yaw *= Math.exp(-dt * 2.5); // drift back behind the ship
    this.desired(this.pos, this.target, aspect);
    const k = 1 - Math.exp(-dt * 6); // ~0.25 s spring
    Vector3.LerpToRef(this.camera.position, this.pos, k, this.camera.position);
    const current = this.camera.getTarget();
    Vector3.LerpToRef(current, this.target, k, current);
    this.camera.setTarget(current);
  }
}
