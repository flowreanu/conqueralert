import { Color3, DirectionalLight, Engine, HemisphericLight, ImageProcessingConfiguration, Scene, ShadowGenerator, Vector3 } from "./render/babylon";
import { createMatchWorld } from "./sim/scenario";
import { Bot } from "./sim/bot";
import { Vision } from "./sim/vision";
import { FogRenderer, registerFogPlugin } from "./render/fog";
import { GameSettings, createPauseMenu, showEndScreen, showMenu } from "./ui/menu";
import { BUILDING_DEFS, Command, DT, TICK_RATE, UNIT_DEFS } from "./sim/world";
import { audio } from "./audio/audio";
import { createGameSounds } from "./audio/gameSounds";
import { renderIcons } from "./render/icons";
import { ModelLibrary } from "./render/models";
import { buildTerrain } from "./render/terrain";
import { buildProps } from "./render/props";
import { RtsCamera } from "./render/camera";
import { EntityRenderer } from "./render/entities";
import { EffectsRenderer } from "./render/effects";
import { InputController } from "./ui/input";
import { setupHud } from "./ui/hud";
import { setupSidebar } from "./ui/sidebar";
import { OreRenderer } from "./render/ore";
import "./style.css";

async function boot(settings: GameSettings) {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) loadingEl.style.display = "grid";
  registerFogPlugin();
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.0;
  scene.imageProcessingConfiguration.contrast = 1.15;

  const world = createMatchWorld({ faction: settings.faction, difficulty: settings.difficulty });
  world.controllers.push(new Bot(1, settings.difficulty));
  const PLAYER = 0;
  const vision = new Vision(world, PLAYER, settings.fog);
  vision.update();
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
  const myBase = map.bases.find((b) => b.faction === settings.faction)!;
  const toCenter = myBase.cx < map.width / 2 ? 1 : -1;
  cam.lookAt((myBase.cx + 8 * toCenter) * map.cellSize, (myBase.cy - 6) * map.cellSize);

  // ceața trebuie să existe înaintea materialelor (pluginul își compilează varianta la prima randare)
  const fog = settings.fog ? new FogRenderer(scene, map, vision) : null;
  buildTerrain(scene, map);
  const lib = new ModelLibrary(scene);
  const view = new EntityRenderer(scene, lib, world, shadows);
  view.vision = settings.fog ? vision : null;
  const fx = new EffectsRenderer(scene, world);
  const ore = new OreRenderer(scene, map, shadows);

  const hud = setupHud(world, view);
  const loading = Promise.all([
    buildProps(scene, lib, map, shadows),
    ...[...world.buildings.values()].map((b) => view.addBuilding(b)),
    ...[...world.units.values()].map((u) => view.addUnit(u)),
  ]);
  await loading;
  document.getElementById("loading")?.remove();

  const input = new InputController(scene, canvas, cam, world, view, PLAYER);
  input.vision = settings.fog ? vision : null;
  input.onSelectionChange = () => hud.update();
  view.onSelectionPruned = () => hud.update();
  const sidebar = setupSidebar(world, view, input, cam, PLAYER, settings.fog ? vision : null);
  // pictogramele 3D ale sidebar-ului (din modelele reale, în culorile facțiunii)
  const iconItems = [
    ...Object.keys(BUILDING_DEFS).filter((k) => BUILDING_DEFS[k].buildable !== false),
    ...Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k].faction === settings.faction),
  ];
  void renderIcons(engine, settings.faction, iconItems, (item, url) => sidebar.setIcon(item, url));

  // sunet: muzica facțiunii + efectele bătăliei + confirmarea ordinelor
  audio.playMusic(settings.faction);
  const sounds = createGameSounds(world, cam.target, settings.fog ? vision : null, PLAYER);
  const issue = world.issue.bind(world);
  world.issue = (c: Command) => {
    if (c.player === PLAYER) {
      if (c.kind === "move" || c.kind === "amove") audio.play("ack", 0.7);
      if (c.kind === "attack") audio.play("ackAttack", 0.7);
    }
    return issue(c);
  };

  // pauză / final de meci
  let paused = false;
  let ended = false;
  const pause = createPauseMenu(() => setPaused(false), () => { setPaused(false); world.surrender(PLAYER); }, settings);
  const setPaused = (v: boolean) => { if (ended) v = false; paused = v; pause.show(v); };
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyP" || (e.code === "Escape" && paused)) { e.preventDefault(); setPaused(!paused); }
  });
  document.getElementById("menu-btn")?.addEventListener("click", () => setPaused(true));
  // pierderea focusului nu mai trage camera cu marginile; jocul nu se oprește singur (ca în RA2 skirmish)

  let acc = 0;
  let last = performance.now();
  let endTimer = 0;
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!paused) acc += dt;
    while (acc >= DT) {
      world.step();
      fx.consume(world.events); view.consume(world.events); sidebar.consume(world.events); sounds.consume(world.events);
      if (world.tick % 4 === 0) vision.update();
      acc -= DT;
    }
    // ecranul de final apare la 2 s după ultima explozie
    if (world.winner >= 0 && !ended && (endTimer += dt) > 2) {
      ended = true;
      setPaused(false);
      vision.update();
      audio.stopMusic(1);
      audio.play(world.winner === PLAYER ? "victory" : "defeat", 1);
      showEndScreen(world, PLAYER, world.tick / TICK_RATE, settings);
    }
    fog?.update(dt);
    cam.update(dt);
    input.update(dt);
    view.sync(acc / DT, dt);
    ore.update(dt);
    fx.update(dt, acc / DT);
    scene.render();
    hud.frame(engine.getFps());
    sidebar.frame();
  });
  window.addEventListener("resize", () => engine.resize());

  // acces pentru teste automate în browser
  (window as any).__ca = { world, view, cam, input, scene, fx, vision, UNIT_DEFS, eco: await import("./sim/economy") };
}

async function start() {
  document.getElementById("loading")!.style.display = "none";
  const settings = await showMenu();
  await boot(settings);
}

start().catch((e) => {
  console.error(e);
  const l = document.getElementById("loading");
  if (l) l.textContent = "Eroare la încărcare: " + (e?.message ?? e);
});
