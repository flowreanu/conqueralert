// S5: variante Toon Shooter (o singură armă, 5 animații). Rulare (din /tmp/tools, cu @gltf-transform/*):
//   node prepare-toon.mjs <Character_X.gltf> <out.glb> <Armă|-> [animația de alergare = Run_Gun]
//   toon_soldier_rocket / toon_enemy_rocket: RocketLauncher; toon_engineer: Character_Hazmat + Pistol + „Run”
// Variante Toon Shooter: păstrează o singură armă (sau niciuna) și 5 animații
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup } from "@gltf-transform/functions";
const [src, out, keepWeapon, runName = "Run_Gun"] = process.argv.slice(2);
const WEAPONS = ["AK","GrenadeLauncher","Knife_1","Knife_2","Pistol","Revolver","Revolver_Small","RocketLauncher","ShortCannon","Shotgun","Shovel","SMG","Sniper","Sniper_2"];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
for (const n of root.listNodes()) if (WEAPONS.includes(n.getName()) && n.getName() !== keepWeapon) n.dispose();
const keep = { Death: "Death", Idle: "Idle", Idle_Shoot: "Idle_Shoot", Walk: "Walk", [runName]: "Run_Gun" };
for (const a of root.listAnimations()) { const k = keep[a.getName()]; if (!k) a.dispose(); else a.setName(k); }
await doc.transform(dedup(), prune());
await io.write(out, doc);
console.log(out, root.listNodes().filter(n=>n.getMesh()).map(n=>n.getName()).join(","), root.listAnimations().map(a=>a.getName()).join(","));
