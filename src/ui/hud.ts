import factionsData from "../data/factions.json";
import { UNIT_DEFS, World } from "../sim/world";
import { EntityRenderer } from "../render/entities";

const FACTIONS = factionsData as Record<string, { name: string; primary: string }>;

/** HUD minimal pentru S1 (sidebar-ul complet vine în S3). */
export function setupHud(world: World, view: EntityRenderer) {
  const top = document.getElementById("hud-top")!;
  const selEl = document.getElementById("hud-sel")!;
  const me = world.players[0];
  top.innerHTML = `<b>ConquerAlert</b> <span class="tag" style="--c:${FACTIONS[me.faction].primary}">${FACTIONS[me.faction].name}</span> <span id="fps"></span>`;
  const fpsEl = document.getElementById("fps")!;
  let frames = 0;

  const update = () => {
    const counts = new Map<string, number>();
    for (const id of view.selected) {
      const u = world.units.get(id);
      if (u) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    }
    selEl.innerHTML = counts.size
      ? [...counts].map(([t, n]) => `<span class="chip">${UNIT_DEFS[t].name}${n > 1 ? ` ×${n}` : ""}</span>`).join("")
      : `<span class="muted">Nimic selectat</span>`;
  };
  update();
  return {
    update,
    frame(fps: number) {
      if (++frames % 30 === 0) fpsEl.textContent = `${fps.toFixed(0)} FPS`;
    },
  };
}
