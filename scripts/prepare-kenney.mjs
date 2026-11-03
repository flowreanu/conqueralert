// Pregătește modelele Kenney (S4.2): copiază ce folosim în public/models/ și recolorează paleta
// (textura „colormap” încorporată) pentru vehiculele de facțiune. Rulare:
//   cd /tmp/tools && npm i @gltf-transform/core @gltf-transform/extensions sharp
//   node scripts/prepare-kenney.mjs <assets_src> <public/models>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [SRC, DST] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const COPY = {
  roads: ["road-straight", "road-intersection", "road-crossroad", "road-bend", "road-end", "light-square", "light-square-double", "construction-barrier", "construction-cone", "dumpster", "electricity-pole", "sign-highway", "road-sign-stop"],
  suburban: ["building-type-a", "building-type-b", "building-type-c", "building-type-d", "building-type-e", "building-type-f", "building-type-g", "building-type-h", "building-type-k", "building-type-m", "building-type-o", "building-type-q", "building-type-s", "fence-1x3", "fence-1x4", "fence-low", "tree-large", "tree-small", "planter"],
  commercial: ["building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h", "low-detail-building-a", "low-detail-building-c", "detail-parasol-a"],
  cars: ["van", "delivery", "taxi", "suv", "police", "firetruck", "ambulance", "truck", "debris-tire", "box", "cone"],
};
const SRCDIR = { roads: "kenny_roads", suburban: "kenny_suburban", commercial: "kenny_city_kit_commercial", cars: "kenny_car_kit" };

for (const [kit, list] of Object.entries(COPY)) {
  fs.mkdirSync(path.join(DST, kit), { recursive: true });
  for (const n of list) fs.copyFileSync(path.join(SRC, SRCDIR[kit], `${n}.glb`), path.join(DST, kit, `${n}.glb`));
  // modelele citesc paleta din Textures/colormap.png (fișier extern, diferit la fiecare kit)
  fs.mkdirSync(path.join(DST, kit, "Textures"), { recursive: true });
  fs.copyFileSync(path.join(SRC, SRCDIR[kit], "Textures/colormap.png"), path.join(DST, kit, "Textures/colormap.png"));
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Recolorare explicită pe căsuțe (cheie „col,rând” → culoare), păstrând degradeul. */
async function recolorCells(srcFile, outFile, map) {
  const doc = await io.read(srcFile);
  const tex = doc.getRoot().listTextures()[0];
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const CW = info.width / 16, CH = info.height / 4;
  const lum = (o) => 0.3 * data[o] + 0.59 * data[o + 1] + 0.11 * data[o + 2];
  const out = Buffer.from(data);
  for (const [k, to] of Object.entries(map)) {
    const [cx, cy] = k.split(",").map(Number);
    const mid = lum(((cy * CH + CH / 2) * info.width + cx * CW + CW / 2) * 4);
    for (let y = cy * CH; y < (cy + 1) * CH; y++)
      for (let x = cx * CW; x < (cx + 1) * CW; x++) {
        const o = (y * info.width + x) * 4;
        const f = Math.min(1.3, lum(o) / Math.max(1, mid));
        out[o] = Math.min(255, to[0] * f); out[o + 1] = Math.min(255, to[1] * f); out[o + 2] = Math.min(255, to[2] * f);
      }
  }
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  tex.setImage(new Uint8Array(png));
  await io.write(outFile, doc);
  console.log(path.basename(outFile), Object.keys(map).join(" "));
}

// asfaltul Kenney e aproape negru-albăstrui → mai deschis și mai neutru (gri de RA2)
{
  const file = path.join(DST, "roads/Textures/colormap.png");
  const { data, info } = await sharp(file).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, (data[i + c] * 0.55 + l * 0.45) * 1.45 + 8);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file + ".tmp");
  fs.renameSync(file + ".tmp", file);
}

// variante de culoare pentru casele / clădirile comerciale (acoperiș + pereți), ca orașele să nu arate la fel
const VARIANTS = {
  suburban: [
    { "1,1": "#d4664a", "3,3": "#d4664a", "1,2": "#d8ccb3" }, // cărămiziu, pereți crem
    { "1,1": "#a0704a", "3,3": "#a0704a", "1,2": "#c9c3b9" }, // maro, pereți gri deschis
    { "1,1": "#6c8db3", "3,3": "#6c8db3", "1,2": "#e0d5c1" }, // albastru-gri, pereți bej
  ],
  commercial: [
    { "1,2": "#c26b52" }, // cărămidă
    { "1,2": "#e0cfac" }, // piatră bej
    { "1,2": "#b4bec8" }, // beton deschis
  ],
};
for (const [kit, list] of Object.entries(VARIANTS)) {
  const srcPal = path.join(SRC, SRCDIR[kit], "Textures/colormap.png");
  const { data, info } = await sharp(srcPal).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const CW = info.width / 16, CH = info.height / 4;
  const lum = (d, o) => 0.3 * d[o] + 0.59 * d[o + 1] + 0.11 * d[o + 2];
  for (let v = 0; v < list.length; v++) {
    const dir = path.join(DST, `${kit}${v + 1}`);
    fs.mkdirSync(path.join(dir, "Textures"), { recursive: true });
    for (const n of COPY[kit]) if (n.startsWith("building")) fs.copyFileSync(path.join(SRC, SRCDIR[kit], `${n}.glb`), path.join(dir, `${n}.glb`));
    const out = Buffer.from(data);
    for (const [k, h] of Object.entries(list[v])) {
      const to = hex(h);
      const [cx, cy] = k.split(",").map(Number);
      const mid = lum(data, ((cy * CH + CH / 2) * info.width + cx * CW + CW / 2) * 4);
      for (let y = cy * CH; y < (cy + 1) * CH; y++)
        for (let x = cx * CW; x < (cx + 1) * CW; x++) {
          const o = (y * info.width + x) * 4, f = Math.min(1.3, lum(data, o) / Math.max(1, mid));
          for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, to[c] * f);
        }
    }
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(path.join(dir, "Textures/colormap.png"));
  }
}

const F = { usa: { p: "#3d7fe0", s: "#cdd8e2", d: "#2c3a46" }, ussr: { p: "#c23a2f", s: "#8c8468", d: "#2d2a26" } };
fs.mkdirSync(path.join(DST, "units"), { recursive: true });
for (const [f, c] of Object.entries(F)) {
  // caroseria (gri, 7,2) → culoarea facțiunii; cabina recoltorului (verde, 7,1) → secundară
  await recolorCells(path.join(SRC, "kenny_car_kit/tractor-shovel.glb"), path.join(DST, "units", `harv_${f}.glb`), { "7,2": hex(c.p), "7,1": hex(c.s) });
  await recolorCells(path.join(SRC, "kenny_car_kit/truck-flat.glb"), path.join(DST, "units", `v3truck_${f}.glb`), { "7,2": hex(c.p) });
}
