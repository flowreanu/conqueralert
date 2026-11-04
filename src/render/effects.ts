import { Color3, InstancedMesh, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "./babylon";
import { SimEvent, UNIT_DEFS, World, WEAPONS } from "../sim/world";
import { groundHeight } from "./terrain";

interface Fx {
  mesh: InstancedMesh;
  t: number;
  life: number;
  /** scară la început / la vârf / la final (vârful la `peak` din viață) */
  s0: number;
  s1: number;
  s2: number;
  peak: number;
  rise: number; // m/s pe verticală (fum)
}

/**
 * Efecte de luptă, toate din instanțe ale câtorva mesh-uri sursă (cost mic):
 * proiectile interpolate, flăcări la gura țevii, explozii, fum, urme arse pe sol.
 */
export class EffectsRenderer {
  private src: Record<string, Mesh> = {};
  private proj = new Map<number, InstancedMesh>();
  private fx: Fx[] = [];
  private tmp = new Vector3();
  private trailT = 0;

  constructor(scene: Scene, private world: World) {
    const glow = (name: string, hex: string) => {
      const m = new StandardMaterial(name, scene);
      m.emissiveColor = Color3.FromHexString(hex);
      m.diffuseColor = Color3.Black();
      m.specularColor = Color3.Black();
      m.disableLighting = true;
      return m;
    };
    const solid = (name: string, hex: string, alpha = 1) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      return m;
    };
    const hide = (m: Mesh) => { m.isPickable = false; m.isVisible = false; m.position.y = -1000; return m; };
    const sphere = (name: string, d: number) => MeshBuilder.CreateSphere(name, { diameter: d, segments: 6 }, scene);

    this.src.bullet = hide(MeshBuilder.CreateBox("fx-bullet", { width: 0.07, height: 0.07, depth: 1.4 }, scene));
    this.src.bullet.material = glow("fx-bullet-m", "#ffe9a0");
    this.src.shell = hide(sphere("fx-shell", 0.35));
    this.src.shell.material = glow("fx-shell-m", "#ffd36a");
    this.src.arc = hide(sphere("fx-arc", 0.5));
    this.src.arc.material = glow("fx-arc-m", "#ffb347");
    this.src.rocket = hide(MeshBuilder.CreateBox("fx-rocket", { width: 0.16, height: 0.16, depth: 0.9 }, scene));
    this.src.rocket.material = glow("fx-rocket-m", "#ff8a3a");
    // racheta V3: corp lung + vârf (axa lungă pe Z, ca restul proiectilelor)
    const body = MeshBuilder.CreateCylinder("fx-missile-b", { height: 3.4, diameter: 0.5, tessellation: 8 }, scene);
    body.rotation.x = Math.PI / 2;
    const nose = MeshBuilder.CreateCylinder("fx-missile-n", { height: 0.9, diameterTop: 0, diameterBottom: 0.5, tessellation: 8 }, scene);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 2.15;
    const flame = MeshBuilder.CreateCylinder("fx-missile-f", { height: 1.1, diameterTop: 0.45, diameterBottom: 0, tessellation: 6 }, scene);
    flame.rotation.x = Math.PI / 2;
    flame.position.z = -2.2;
    body.material = solid("fx-missile-bm", "#5d6152");
    nose.material = solid("fx-missile-nm", "#b8352b");
    flame.material = glow("fx-missile-fm", "#ffb347");
    this.src.missile = hide(Mesh.MergeMeshes([body, nose, flame], true, true, undefined, false, true)!);
    this.src.flash = hide(sphere("fx-flash", 1));
    this.src.flash.material = glow("fx-flash-m", "#fff1b0");
    this.src.fire = hide(sphere("fx-fire", 1));
    this.src.fire.material = glow("fx-fire-m", "#ff7a26");
    this.src.core = hide(sphere("fx-core", 1));
    this.src.core.material = glow("fx-core-m", "#ffe08a");
    this.src.smoke = hide(sphere("fx-smoke", 1));
    this.src.smoke.material = solid("fx-smoke-m", "#3a3936", 0.75);
    this.src.dust = hide(sphere("fx-dust", 1));
    this.src.dust.material = solid("fx-dust-m", "#8d8068", 0.7);
    this.src.scorch = hide(MeshBuilder.CreateDisc("fx-scorch", { radius: 1, tessellation: 18 }, scene));
    this.src.scorch.rotation.x = Math.PI / 2;
    this.src.scorch.bakeCurrentTransformIntoVertices();
    this.src.scorch.material = solid("fx-scorch-m", "#1e1b18", 0.55);
  }

  /** Apelat după fiecare tick al simulării. */
  consume(events: SimEvent[]) {
    for (const e of events) {
      if (e.kind === "fire") {
        const w = WEAPONS[e.weapon];
        if (w.projectile === "rocket" || w.projectile === "missile") this.spawn("smoke", e.x, e.y, e.z, w.projectile === "missile" ? 1 : 0.4, w.projectile === "missile" ? 2.6 : 1.1, 0.1, w.projectile === "missile" ? 1.6 : 0.8, 0.3, 1.2);
        else this.spawn("flash", e.x, e.y, e.z, w.projectile === "bullet" ? 0.35 : 0.9, w.projectile === "bullet" ? 0.5 : 1.5, 0.2, 0.1, 0.3);
      } else if (e.kind === "impact") {
        const w = WEAPONS[e.weapon];
        const y = groundHeight(this.world.map, e.x, e.z);
        if (w.projectile === "bullet") { this.spawn("dust", e.x, y + 0.3, e.z, 0.2, 0.6, 0.05, 0.3, 0.3, 0.4); continue; }
        const r = Math.max(1.1, e.splash);
        this.spawn("fire", e.x, y + 0.6, e.z, 0.4, r * 1.3, 0.2, 0.3, 0.25);
        this.spawn("core", e.x, y + 0.7, e.z, 0.3, r * 0.8, 0.1, 0.2, 0.2);
        this.spawn("smoke", e.x, y + 1, e.z, 0.5, r * 1.4, 0.1, 1.3, 0.35, 1.5);
        if (e.splash) this.spawn("scorch", e.x, y + 0.05, e.z, r * 0.7, r * 0.8, 0.01, 8, 0.05);
      } else if (e.kind === "death") {
        const y = groundHeight(this.world.map, e.x, e.z);
        const big = e.entity === "building";
        const r = e.size * (big ? 1.2 : 1.4);
        if (e.entity === "unit" && UNIT_DEFS[e.type]?.armor === "infantry") {
          this.spawn("dust", e.x, y + 0.5, e.z, 0.4, 1.6, 0.1, 0.9, 0.3, 0.8);
          continue;
        }
        this.spawn("fire", e.x, y + 1, e.z, 0.5, r * 1.6, 0.4, 0.6, 0.3);
        this.spawn("core", e.x, y + 1.2, e.z, 0.4, r, 0.2, 0.4, 0.25);
        for (let i = 0; i < (big ? 5 : 2); i++) {
          const a = (i / (big ? 5 : 2)) * Math.PI * 2 + e.id;
          this.spawn("fire", e.x + Math.cos(a) * r * 0.5, y + 0.8, e.z + Math.sin(a) * r * 0.5, 0.3, r * 0.9, 0.2, 0.5 + i * 0.08, 0.35);
        }
        this.spawn("smoke", e.x, y + 1.5, e.z, 1, r * 2, 0.2, big ? 3.5 : 2.4, 0.3, big ? 2.2 : 1.6);
        this.spawn("scorch", e.x, y + 0.06, e.z, r * 0.9, r, 0.01, 15, 0.05);
      }
    }
  }

  private spawn(kind: string, x: number, y: number, z: number, s0: number, s1: number, s2: number, life: number, peak: number, rise = 0) {
    const mesh = this.src[kind].createInstance(`fx-${kind}`);
    mesh.isPickable = false;
    mesh.position.set(x, y, z);
    mesh.scaling.setAll(s0);
    this.fx.push({ mesh, t: 0, life, s0, s1, s2, peak, rise });
  }

  /** dt = timpul real al cadrului; alpha = interpolarea dintre tick-uri. */
  update(dt: number, alpha: number) {
    // proiectile
    for (const [id, inst] of this.proj) if (!this.world.projectiles.has(id)) { inst.dispose(); this.proj.delete(id); }
    for (const p of this.world.projectiles.values()) {
      let inst = this.proj.get(p.id);
      if (!inst) {
        inst = this.src[WEAPONS[p.weapon].projectile].createInstance(`p${p.id}`);
        inst.isPickable = false;
        this.proj.set(p.id, inst);
      }
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      const z = p.prevZ + (p.z - p.prevZ) * alpha;
      inst.position.set(x, y, z);
      // dâra de fum a rachetei V3
      if (WEAPONS[p.weapon].projectile === "missile") {
        this.trailT += dt;
        if (this.trailT > 0.045) { this.trailT = 0; this.spawn("smoke", x, y, z, 0.5, 1.4, 1.9, 1.6, 0.25, 0.4); }
      }
      const dx = p.x - p.prevX, dy = p.y - p.prevY, dz = p.z - p.prevZ;
      if (dx * dx + dz * dz > 1e-6) {
        this.tmp.set(x + dx, y + dy, z + dz);
        inst.lookAt(this.tmp); // mesh-urile alungite sunt lungi pe Z
      }
    }
    // efecte
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { f.mesh.dispose(); this.fx.splice(i, 1); continue; }
      const s = k < f.peak ? f.s0 + (f.s1 - f.s0) * easeOut(k / f.peak) : f.s1 + (f.s2 - f.s1) * ((k - f.peak) / (1 - f.peak));
      f.mesh.scaling.setAll(Math.max(0.001, s));
      if (f.rise) f.mesh.position.y += f.rise * dt;
    }
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
