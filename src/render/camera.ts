import { Scene, TargetCamera, Vector3 } from "./babylon";

/**
 * Cameră RTS: unghi fix (~55°), fără rotire. Pan cu WASD / săgeți / marginile ecranului,
 * zoom cu rotița (spre cursor nu — simplu, spre centru).
 */
export class RtsCamera {
  readonly camera: TargetCamera;
  readonly target = new Vector3();
  dist = 62;
  readonly minDist = 22;
  readonly maxDist = 130;
  readonly pitch = (55 * Math.PI) / 180;
  private keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  edgeScroll = true;

  constructor(scene: Scene, private canvas: HTMLCanvasElement, private bounds: { w: number; h: number }) {
    this.camera = new TargetCamera("rtsCam", new Vector3(0, 50, -50), scene);
    this.camera.fov = 0.75;
    this.camera.minZ = 1;
    this.camera.maxZ = 800;
    this.target.set(bounds.w / 2, 0, bounds.h / 2);

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => { this.keys.clear(); this.mouse = null; });
    canvas.addEventListener("pointermove", (e) => { this.mouse = { x: e.clientX, y: e.clientY }; });
    document.addEventListener("pointerleave", () => { this.mouse = null; });
    canvas.addEventListener("pointerleave", () => { this.mouse = null; });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * Math.pow(1.0015, e.deltaY)));
      },
      { passive: false },
    );
    this.apply();
  }

  lookAt(x: number, z: number) {
    this.target.x = x;
    this.target.z = z;
    this.clamp();
    this.apply();
  }

  update(dt: number) {
    const speed = this.dist * 1.1 * dt;
    let dx = 0, dz = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) dx -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) dx += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) dz += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) dz -= 1;
    if (this.edgeScroll && this.mouse) {
      const m = 14, r = this.canvas.getBoundingClientRect();
      if (this.mouse.x < r.left + m) dx -= 1;
      if (this.mouse.x > r.right - m) dx += 1;
      if (this.mouse.y < r.top + m) dz += 1;
      if (this.mouse.y > r.bottom - m) dz -= 1;
    }
    if (dx || dz) {
      const l = Math.hypot(dx, dz);
      this.target.x += (dx / l) * speed;
      this.target.z += (dz / l) * speed;
    }
    this.clamp();
    this.apply();
  }

  private clamp() {
    const pad = 6;
    this.target.x = Math.min(this.bounds.w - pad, Math.max(pad, this.target.x));
    // camera privește spre +z → la marginea de sud lăsăm mai mult loc
    this.target.z = Math.min(this.bounds.h - pad, Math.max(pad, this.target.z));
  }

  private apply() {
    const c = this.camera;
    c.position.set(this.target.x, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z - Math.cos(this.pitch) * this.dist);
    c.setTarget(this.target);
  }
}
