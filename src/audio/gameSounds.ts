import { audio, Sfx } from "./audio";
import { SimEvent, UNIT_DEFS, World } from "../sim/world";
import type { Vision } from "../sim/vision";

const FIRE: Record<string, Sfx> = {
  rifleUsa: "rifle", rifleUssr: "rifle2", cannon90: "cannon", cannon120x2: "cannon2",
  howitzer: "howitzer", v3: "v3", rockets: "v3", turretGun: "turret",
  bazooka: "rocketAt", rpg7: "rocketAt", mgUsa: "mg", mgUssr: "mg",
};

/** Sunetele bătăliei, poziționate față de centrul camerei (volum după distanță, stânga/dreapta după poziție). */
export function createGameSounds(world: World, listener: { x: number; z: number }, vision: Vision | null, player: number) {
  const spatial = (x: number, z: number, own: boolean) => {
    const dx = x - listener.x, dz = z - listener.z;
    const d = Math.hypot(dx, dz);
    let v = d < 35 ? 1 : Math.max(0, 1 - (d - 35) / 85);
    if (!own && vision?.enabled && !vision.isVisible(x, z)) v *= 0.3;
    return { v, pan: Math.max(-1, Math.min(1, dx / 50)) * 0.8 };
  };
  const ownerAt = (id: number) => world.units.get(id)?.owner ?? world.buildings.get(id)?.owner ?? -1;
  return {
    consume(events: SimEvent[]) {
      for (const e of events) {
        if (e.kind === "fire") {
          const s = FIRE[e.weapon];
          if (!s) continue;
          const { v, pan } = spatial(e.x, e.z, ownerAt(e.sourceId) === player);
          audio.play(s, v * (s.startsWith("rifle") ? 0.55 : 0.8), pan);
        } else if (e.kind === "impact") {
          if (e.weapon.startsWith("rifle")) continue;
          const { v, pan } = spatial(e.x, e.z, false);
          audio.play(e.splash > 0 ? "bigBoom" : "boom", v * 0.75, pan);
        } else if (e.kind === "death") {
          const { v, pan } = spatial(e.x, e.z, false);
          if (e.entity === "building") audio.play("buildingBoom", v, pan);
          else if ((UNIT_DEFS[e.type]?.radius ?? 1) < 1) audio.play("infDeath", v * 0.6, pan);
          else audio.play("bigBoom", v, pan);
        } else if (e.kind === "placed" && e.player === player) audio.play("place", 0.9);
      }
    },
  };
}
