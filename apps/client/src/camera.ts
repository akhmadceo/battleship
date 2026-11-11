import { type Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { GRID_CENTER } from './world';

export type CameraMode = 'overview' | 'chase' | 'aim';

const ZOOM = [0.72, 1, 1.35];
const MAX_YAW = Math.PI / 3; // ±60°

/**
 * Camera rig. Overview frames both floating islands side by side like the
 * paper game; chase sits behind and above the active ship looking across at
 * the enemy island; aim hangs in front of the enemy board to read its grid.
 * Every change is a smooth blend.
 */
export class CameraRig {
  readonly camera: UniversalCamera;
  mode: CameraMode = 'overview';
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
    this.camera = new UniversalCamera('cam', new Vector3(0, 160, -260), scene);
    this.camera.fov = 0.9;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 4000;
    this.camera.inputs.clear();
    this.desired(this.pos, this.target, 16 / 9);
    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(this.target);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  /** Switch to a view, or back to the overview if it is already on. */
  toggle(mode: Exclude<CameraMode, 'overview'>): void {
    this.mode = this.mode === mode ? 'overview' : mode;
  }

  orbit(deltaYaw: number): void {
    this.yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, this.yaw + deltaYaw));
    this.idle = 0;
  }

  cycleZoom(dir: 1 | -1): void {
    this.zoom = Math.max(0, Math.min(ZOOM.length - 1, this.zoom + dir));
  }

  private desired(pos: Vector3, target: Vector3, aspect: number): void {
    const z = ZOOM[this.zoom]!;
    const tanH = Math.tan(this.camera.fov / 2);
    if (this.mode === 'overview') {
      // Fit both islands (x ±165) and their depth, seen from the front and above.
      const dist = Math.max((aspect < 1 ? 152 : 168) / (tanH * aspect), 115 / tanH) * z;
      const pitch = aspect < 1 ? 1.0 : 0.74; // ~42° down, steeper on tall screens
      const sideways = Math.sin(this.yaw) * dist * 0.5;
      target.set(0, -6, 6);
      pos.set(sideways, Math.sin(pitch) * dist - 6, 6 - Math.cos(pitch) * dist);
      return;
    }
    if (this.mode === 'aim') {
      const look = GRID_CENTER.enemy;
      const dist = Math.max(72 / (tanH * aspect), 76 / tanH) * z;
      const pitch = 0.95;
      target.set(look.x, 0, look.z + 4);
      pos.set(look.x + Math.sin(this.yaw) * dist * 0.6, Math.sin(pitch) * dist, look.z + 4 - Math.cos(pitch) * dist);
      return;
    }
    // Chase: behind our ship, looking across the gap at the enemy island (+x).
    const heading = Math.PI / 2 + this.yaw;
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const dist = 58 * z * (aspect < 1 ? 1.5 : 1);
    pos.copyFrom(this.anchor).addInPlace(forward.scale(-dist)).addInPlace(new Vector3(0, dist * 0.5, 0));
    target.copyFrom(this.anchor).addInPlace(forward.scale(40)).addInPlace(new Vector3(0, 2, 0));
    if (this.focus) Vector3.LerpToRef(target, this.focus, 0.6, target);
  }

  update(dt: number, aspect: number): void {
    this.idle += dt;
    if (this.idle > 2) this.yaw *= Math.exp(-dt * 2.5); // drift back to the default angle
    this.desired(this.pos, this.target, aspect);
    const k = 1 - Math.exp(-dt * 5);
    Vector3.LerpToRef(this.camera.position, this.pos, k, this.camera.position);
    const current = this.camera.getTarget();
    Vector3.LerpToRef(current, this.target, k, current);
    this.camera.setTarget(current);
  }
}
