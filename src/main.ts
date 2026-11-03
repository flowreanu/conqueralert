import { Color3, DirectionalLight, Engine, HemisphericLight, ImageProcessingConfiguration, Scene, ShadowGenerator, Vector3 } from "./render/babylon";
import { createDemoWorld } from "./sim/scenario";
import { DT, UNIT_DEFS } from "./sim/world";
import { ModelLibrary } from "./render/models";
import { buildTerrain } from "./render/terrain";
import { buildProps } from "./render/props";
import { RtsCamera } from "./render/camera";
import { EntityRenderer } from "./render/entities";
import { EffectsRenderer } from "./render/effects";
import { InputController } from "./ui/input";
import { setupHud } from "./ui/hud";
import "./style.css";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.0;
  scene.imageProcessingConfiguration.contrast = 1.15;

  const world = createDemoWorld();
  const map = world.map;
  const W = map.width * map.cellSize, H = map.height * map.cellSize;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, -0.3), scene);
  hemi.intensity = 0.5;
  hemi.groundColor = new Color3(0.35, 0.38, 0.42);
  const sun = new DirectionalLight("sun", new Vector3(-0.55, -0.8, 0.4).normalize(), scene);
  sun.intensity = 1.35;
  sun.position = new Vector3(W / 2, 0, H / 2).subtract(sun.direction.scale(200));
  // extinderi fixe: șabloanele ascunse (y=-1000) nu trebuie să strice harta de umbre
  sun.shadowFrustumSize = 290;
  sun.shadowMinZ = 50;
  sun.shadowMaxZ = 350;
  const shadows = new ShadowGenerator(2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.0015;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.3;

  const cam = new RtsCamera(scene, canvas, { w: W, h: H });
  const usaBase = map.bases.find((b) => b.faction === "usa")!;
  cam.lookAt((usaBase.cx + 8) * map.cellSize, (usaBase.cy - 6) * map.cellSize);

  buildTerrain(scene, map);
  const lib = new ModelLibrary(scene);
  const view = new EntityRenderer(scene, lib, world, shadows);
  const fx = new EffectsRenderer(scene, world);

  const hud = setupHud(world, view);
  const loading = Promise.all([
    buildProps(scene, lib, map, shadows),
    ...[...world.buildings.values()].map((b) => view.addBuilding(b)),
    ...[...world.units.values()].map((u) => view.addUnit(u)),
  ]);
  await loading;
  document.getElementById("loading")?.remove();

  const input = new InputController(scene, canvas, cam, world, view, 0);
  input.onSelectionChange = () => hud.update();
  view.onSelectionPruned = () => hud.update();

  let acc = 0;
  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= DT) { world.step(); fx.consume(world.events); acc -= DT; }
    cam.update(dt);
    input.update(dt);
    view.sync(acc / DT);
    fx.update(dt, acc / DT);
    scene.render();
    hud.frame(engine.getFps());
  });
  window.addEventListener("resize", () => engine.resize());

  // acces pentru teste automate în browser
  (window as any).__ca = { world, view, cam, input, scene, fx, UNIT_DEFS };
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById("loading");
  if (l) l.textContent = "Eroare la încărcare: " + (e?.message ?? e);
});
