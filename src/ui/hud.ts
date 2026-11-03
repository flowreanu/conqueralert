import factionsData from "../data/factions.json";
import { UNIT_DEFS, World } from "../sim/world";
import { EntityRenderer } from "../render/entities";

const FACTIONS = factionsData as Record<string, { name: string; primary: string }>;

/** HUD minimal (sidebar-ul complet vine în S3). */
export function setupHud(world: World, view: EntityRenderer) {
  const top = document.getElementById("hud-top")!;
  const selEl = document.getElementById("hud-sel")!;
  const me = world.players[0];
  top.innerHTML = `<b>ConquerAlert</b> <span class="tag" style="--c:${FACTIONS[me.faction].primary}">${FACTIONS[me.faction].name}</span> <span id="forces"></span> <span id="fps"></span>`;
  const fpsEl = document.getElementById("fps")!;
  const forcesEl = document.getElementById("forces")!;
  let frames = 0;

  const hpSummary = () => {
    let hp = 0, max = 0;
    for (const id of view.selected) { const u = world.units.get(id); if (u) { hp += u.hp; max += u.maxHp; } }
    return max ? `<span class="muted">viață ${Math.round((hp / max) * 100)}%</span>` : "";
  };
  const update = () => {
    const counts = new Map<string, number>();
    for (const id of view.selected) {
      const u = world.units.get(id);
      if (u) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    }
    selEl.innerHTML = counts.size
      ? [...counts].map(([t, n]) => `<span class="chip">${UNIT_DEFS[t].name}${n > 1 ? ` ×${n}` : ""}</span>`).join("") + hpSummary()
      : `<span class="muted">Nimic selectat</span>`;
  };
  update();
  return {
    update,
    frame(fps: number) {
      if (++frames % 30 !== 0) return;
      fpsEl.textContent = `${fps.toFixed(0)} FPS`;
      const n = [0, 0];
      for (const u of world.units.values()) n[u.owner]++;
      forcesEl.innerHTML = world.players.map((p, i) => `<span style="color:${FACTIONS[p.faction].primary}">${FACTIONS[p.faction].name} ${n[i]}</span>`).join(" · ");
    },
  };
}
