import factionsData from "../data/factions.json";
import { GameMap, Terrain } from "../map/gameMap";
import { BUILDING_DEFS, RANK_NAMES, SimEvent, UNIT_DEFS, World } from "../sim/world";
import { CATEGORIES, Category, availability, buildTime, categoryOf, costOf, isLowPower, itemsFor, REPAIR_COST, SELL_REFUND } from "../sim/economy";
import { EntityRenderer } from "../render/entities";
import { RtsCamera } from "../render/camera";
import { InputController } from "./input";
import { Vis, Vision } from "../sim/vision";
import { audio } from "../audio/audio";
import { flagSvg } from "./flags";

const FACTIONS = factionsData as Record<string, { name: string; primary: string; secondary: string; dark: string }>;

const TABS: { cat: Category; label: string; icon: string }[] = [
  { cat: "structure", label: "Clădiri", icon: "structure" },
  { cat: "defense", label: "Apărare", icon: "turret" },
  { cat: "infantry", label: "Infanterie", icon: "infantry" },
  { cat: "vehicle", label: "Vehicule", icon: "tank" },
];

/** Pictograme SVG minimaliste (40×40) pentru „cameo”-uri. */
const ICON_PATHS: Record<string, string> = {
  structure: '<path d="M6 30h28M9 30V16l11-7 11 7v14M16 30v-8h8v8"/>',
  conyard: '<path d="M5 31h30M8 31V17h24v14M12 17V11h16v6M20 11V6M17 23h6"/>',
  power: '<path d="M8 31h24M11 31V12h18v19"/><path d="M21 15l-5 8h5l-2 6 6-9h-5l2-5z" class="f"/>',
  refinery: '<path d="M5 31h30M7 31V18h14v13M25 31V13a5 5 0 0 1 8 0v18M11 18v-5h6v5"/>',
  barracks: '<path d="M5 31h30M7 31V17l13-6 13 6v14M14 31v-7h12v7M13 20h3M24 20h3"/>',
  factory: '<path d="M4 31h32M6 31V19l7 4v-4l7 4v-4l7 4V11h5v20"/><path d="M15 31v-5h10v5"/>',
  turret: '<path d="M9 31h22M12 31v-6h16v6M15 25v-5h10v5M23 21l10-5"/>',
  infantry: '<circle cx="20" cy="9" r="3.5"/><path d="M20 13v10M14 17l6-2 6 2M20 23l-4 9M20 23l4 9M26 17l5-5"/>',
  tank: '<path d="M5 26h30l-3 5H8zM9 26v-5h22v5M15 21v-4h10v4M25 18l11-3"/>',
  support: '<path d="M5 27h22l-2 4H8zM8 27v-5h16v5"/><path d="M14 22l16-12M30 10l3 1M12 31a2 2 0 1 0 0.1 0M22 31a2 2 0 1 0 0.1 0"/>',
  economy: '<path d="M4 27h32M6 27V16h14v11M20 27V12h8l6 7v8"/><circle cx="11" cy="29" r="2.5"/><circle cx="29" cy="29" r="2.5"/><path d="M9 16l4-5h4"/>',
  antitank: '<circle cx="17" cy="9" r="3.5"/><path d="M17 13v10M12 17l5-2 5 2M17 23l-4 9M17 23l4 9M8 13l24-5M32 8l3-1"/>',
  scout: '<path d="M5 26h30l-2-7H24l-3-5h-9l-3 5H7zM15 14V10h6v4M18 10h9"/><circle cx="11" cy="28" r="2.5"/><circle cx="29" cy="28" r="2.5"/>',
  engineer: '<circle cx="18" cy="9" r="3.5"/><path d="M18 13v10M12 17l6-2 6 2M18 23l-4 9M18 23l4 9"/><path d="M27 15l6 6M25 19l4-4 3 1 1 3-4 4z"/>',
};
const icon = (k: string) => `<svg viewBox="0 0 40 40" class="ico">${ICON_PATHS[k] ?? ICON_PATHS.structure}</svg>`;
const iconFor = (item: string) => (BUILDING_DEFS[item] ? item : UNIT_DEFS[item]?.role ?? "structure");
const nameOf = (item: string) => BUILDING_DEFS[item]?.name ?? UNIT_DEFS[item]?.name ?? item;

export interface Sidebar {
  frame(): void;
  consume(events: SimEvent[]): void;
  /** pictograma 3D generată pentru un element (înlocuiește desenul SVG) */
  setIcon(item: string, url: string): void;
}

export function setupSidebar(world: World, view: EntityRenderer, input: InputController, cam: RtsCamera, player: number, vision: Vision | null = null): Sidebar {
  const me = world.players[player];
  const fc = FACTIONS[me.faction];
  const root = document.getElementById("sidebar")!;
  root.style.setProperty("--fc", fc.primary);
  root.innerHTML = `
    <div class="sb-head frame">
      <span class="sb-title">ConquerAlert</span>
      <span class="sb-fac" title="${fc.name}">${flagSvg(me.faction)}<b>${fc.name}</b></span>
      <button class="sb-mute" id="sb-mute" title="Sunet (M)"></button>
    </div>
    <div class="sb-stats frame">
      <div class="sb-credits"><span class="cur">$</span><span id="sb-credits">0</span></div>
      <div class="sb-power"><span class="bolt">⚡</span><div class="sb-power-bar"><div id="sb-power-use"></div><div id="sb-power-out"></div></div><span id="sb-power-txt"></span></div>
    </div>
    <div class="sb-radar frame">
      <canvas id="minimap" width="192" height="192"></canvas>
      <div class="radar-grid"></div><div class="radar-sweep"></div>
      <i class="br tl"></i><i class="br tr"></i><i class="br bl"></i><i class="br br2"></i>
    </div>
    <div class="sb-tabs">${TABS.map((t) => `<button class="tab" data-cat="${t.cat}" title="${t.label}">${icon(t.icon)}<span>${t.label}</span></button>`).join("")}</div>
    <div class="sb-grid frame" id="sb-grid"></div>
    <div class="sb-info frame" id="sb-info"></div>
    <div class="sb-toast" id="sb-toast"></div>`;
  const pics = new Map<string, string>();
  const picFor = (it: string) => (pics.has(it) ? `<img class="pic" src="${pics.get(it)}" alt="" draggable="false">` : icon(iconFor(it)));
  const muteBtn = document.getElementById("sb-mute")!;
  const showMute = () => { muteBtn.textContent = audio.settings.muted ? "🔇" : "🔊"; muteBtn.classList.toggle("off", audio.settings.muted); };
  const toggleMute = () => { audio.setVolumes({ muted: !audio.settings.muted }); showMute(); };
  muteBtn.addEventListener("click", toggleMute);
  window.addEventListener("keydown", (e) => { if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey) toggleMute(); });
  showMute();
  const creditsEl = document.getElementById("sb-credits")!;
  const grid = document.getElementById("sb-grid")!;
  const info = document.getElementById("sb-info")!;
  const toast = document.getElementById("sb-toast")!;
  const powerUse = document.getElementById("sb-power-use")!;
  const powerOut = document.getElementById("sb-power-out")!;
  const powerTxt = document.getElementById("sb-power-txt")!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".tab")];
  const eco = () => world.eco[player];

  let cat: Category = "structure";
  let shownCredits = eco().credits;
  let frames = 0;
  let sellArm = 0;
  let infoKey = "";

  // ─── notificări (gen EVA) ───
  let toastT = 0;
  const say = (text: string, kind = "", sfx?: Parameters<typeof audio.play>[0]) => {
    if (sfx) audio.play(sfx, 0.8);
    toast.textContent = text;
    toast.className = `sb-toast show ${kind}`;
    toastT = performance.now();
  };

  // ─── grila de producție ───
  const renderGrid = () => {
    const items = itemsFor(world, player, cat);
    grid.innerHTML = items
      .map((it) => `<button class="cameo" data-item="${it}">${picFor(it)}<span class="nm">${nameOf(it)}</span><span class="cost">$${costOf(it)}</span><div class="clock"></div><span class="count"></span><span class="st"></span></button>`)
      .join("");
    tabs.forEach((t) => t.classList.toggle("on", t.dataset.cat === cat));
    updateGrid();
  };
  const setTab = (c: Category) => { cat = c; renderGrid(); };
  tabs.forEach((t) => t.addEventListener("click", () => { audio.play("tab", 0.6); setTab(t.dataset.cat as Category); }));

  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".cameo");
    if (!b) return;
    const item = b.dataset.item!;
    const c = categoryOf(item)!;
    const q = eco().queues[c];
    if (!availability(world, player, item).ok) { say(`Necesită: ${availability(world, player, item).missing.map(nameOf).join(", ")}`, "warn", "error"); return; }
    if (c === "structure" || c === "defense") {
      if (q[0]?.type === item && q[0].ready) { audio.play("click", 0.6); input.startPlacing(input.placing === item ? null : item); return; }
      if (q.length) { say("Se construiește deja altceva", "warn", "error"); return; }
      audio.play("click", 0.6);
      world.issue({ kind: "produce", player, item });
      return;
    }
    audio.play("click", 0.6);
    const n = (e as MouseEvent).shiftKey ? 5 : 1;
    for (let i = 0; i < n; i++) world.issue({ kind: "produce", player, item });
  });
  grid.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".cameo");
    if (!b) return;
    const item = b.dataset.item!;
    if (input.placing === item) input.startPlacing(null);
    const n = e.shiftKey ? 5 : 1;
    audio.play("tab", 0.5);
    for (let i = 0; i < n; i++) world.issue({ kind: "cancel", player, item });
  });
  input.onPlacingChange = () => updateGrid();

  const updateGrid = () => {
    const e = eco();
    const low = isLowPower(e);
    for (const b of grid.querySelectorAll<HTMLButtonElement>(".cameo")) {
      const item = b.dataset.item!;
      const c = categoryOf(item)!;
      const q = e.queues[c];
      const av = availability(world, player, item);
      const mine = q.filter((x) => x.type === item);
      const head = q[0]?.type === item ? q[0] : null;
      const clock = b.querySelector<HTMLDivElement>(".clock")!;
      const st = b.querySelector<HTMLSpanElement>(".st")!;
      const cnt = b.querySelector<HTMLSpanElement>(".count")!;
      b.classList.toggle("off", !av.ok);
      b.classList.toggle("busy", !!q.length && !head && (c === "structure" || c === "defense"));
      b.classList.toggle("ready", !!head?.ready);
      b.classList.toggle("placing", input.placing === item);
      clock.style.setProperty("--p", head && !head.ready ? String(head.progress) : mine.length ? "0" : "1");
      clock.style.display = mine.length && !head?.ready ? "block" : "none";
      cnt.textContent = mine.length > 1 ? String(mine.length) : "";
      const waiting = head && !head.ready && e.credits < 1;
      st.textContent = head?.ready ? (input.placing === item ? "PLASEAZĂ" : "GATA") : waiting ? "FONDURI" : head ? `${Math.floor(head.progress * 100)}%${low ? " ⚡" : ""}` : mine.length ? "ÎN COADĂ" : "";
      b.title = `${nameOf(item)} — $${costOf(item)}, ${Math.round(buildTime(costOf(item)))} s${av.ok ? "" : `\nNecesită: ${av.missing.map(nameOf).join(", ")}`}\nClick: construiește${c === "infantry" || c === "vehicle" ? " (Shift: ×5)" : ""} · Click dreapta: anulează`;
    }
    for (const t of tabs) {
      const q = e.queues[t.dataset.cat as Category];
      t.classList.toggle("has-ready", !!q[0]?.ready);
      t.classList.toggle("has-work", !!q.length && !q[0]?.ready);
    }
  };

  // ─── panou de informații (clădirea selectată / recoltoare) ───
  info.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    const id = view.selectedBuilding;
    if (!btn || !id) return;
    audio.play("click", 0.6);
    if (btn.dataset.act === "repair") world.issue({ kind: "repair", player, buildingId: id });
    if (btn.dataset.act === "evacuate") world.issue({ kind: "evacuate", player, buildingId: id });
    if (btn.dataset.act === "sell") {
      if (performance.now() - sellArm < 2500) { world.issue({ kind: "sell", player, buildingId: id }); sellArm = 0; view.selectedBuilding = 0; }
      else sellArm = performance.now();
      infoKey = "";
    }
  });
  const updateInfo = () => {
    const b = view.selectedBuilding ? world.buildings.get(view.selectedBuilding) : undefined;
    let html = "", key = "";
    if (b && BUILDING_DEFS[b.type].category === "civilian") {
      // casă ocupată / puț de petrol
      const def = BUILDING_DEFS[b.type];
      const hpPct = Math.round((b.hp / b.maxHp) * 100);
      key = `c${b.id}|${hpPct}|${b.garrison.length}`;
      const inside = b.garrison.map((u) => `${UNIT_DEFS[u.type].name}${u.rank ? ` (${RANK_NAMES[u.rank]})` : ""}`).join(", ");
      html = `<div class="ib-name">${def.name}</div>
        <div class="ib-hp"><div style="width:${hpPct}%"></div></div>
        <div class="ib-row muted">Viață ${hpPct}%${def.income ? ` · Venit +$${def.income}/s` : ""}${def.garrison ? `<br>Soldați: ${b.garrison.length} / ${def.garrison}${inside ? ` — ${inside}` : ""}<br>Trag pe ferestre (+6 m rază). Artileria și rachetele sunt periculoase.` : ""}</div>
        ${def.garrison ? `<div class="ib-btns"><button data-act="evacuate" ${b.garrison.length ? "" : "disabled"}>Ieșiți din clădire</button></div>` : ""}`;
    } else if (b) {
      const def = BUILDING_DEFS[b.type];
      const armed = performance.now() - sellArm < 2500;
      const hpPct = Math.round((b.hp / b.maxHp) * 100);
      const repairCost = Math.ceil((def.cost * REPAIR_COST * (b.maxHp - b.hp)) / b.maxHp);
      key = `b${b.id}|${hpPct}|${b.repairing}|${armed}`;
      html = `<div class="ib-name">${def.name}</div>
        <div class="ib-hp"><div style="width:${hpPct}%"></div></div>
        <div class="ib-row muted">Viață ${hpPct}% · Energie ${def.power > 0 ? "+" : ""}${def.power}${def.produces ? "<br>Click dreapta pe hartă: punct de adunare" : ""}</div>
        <div class="ib-btns">
          <button data-act="repair" class="${b.repairing ? "on" : ""}" ${b.hp >= b.maxHp ? "disabled" : ""}>${b.repairing ? "Se repară…" : `Repară${repairCost ? ` ($${repairCost})` : ""}`}</button>
          <button data-act="sell" class="${armed ? "warn" : ""}">${armed ? "Sigur? Vinde" : `Vinde (+$${Math.floor(def.cost * SELL_REFUND * (b.hp / b.maxHp))})`}</button>
        </div>`;
    } else {
      const harvs = [...view.selected].map((id) => world.units.get(id)).filter((u) => u?.harv);
      if (harvs.length) {
        const load = harvs.reduce((s, u) => s + u!.harv!.load, 0), cap = harvs.reduce((s, u) => s + UNIT_DEFS[u!.type].capacity!, 0);
        const modes: Record<string, string> = { idle: "în așteptare", toOre: "spre minereu", mining: "recoltează", toRef: "spre rafinărie", unload: "descarcă" };
        key = `h${Math.round(load / 20)}|${harvs[0]!.harv!.mode}`;
        html = `<div class="ib-name">Recoltor${harvs.length > 1 ? ` ×${harvs.length}` : ""}</div>
          <div class="ib-hp ore"><div style="width:${(load / cap) * 100}%"></div></div>
          <div class="ib-row muted">Încărcătură ${Math.round(load)} / ${cap} · ${modes[harvs[0]!.harv!.mode]}<br>Click dreapta pe minereu: recoltează · pe rafinărie: descarcă</div>`;
      } else if (view.selected.size) {
        // unitățile selectate: nume, viață, rang
        const us = [...view.selected].map((id) => world.units.get(id)!).filter(Boolean);
        const hp = us.reduce((a, u) => a + u.hp, 0), max = us.reduce((a, u) => a + u.maxHp, 0);
        const vets = us.filter((u) => u.rank > 0).length;
        const one = us.length === 1 ? us[0] : null;
        const def = one ? UNIT_DEFS[one.type] : null;
        const nextXp = one && one.rank < 4 ? Math.ceil(def!.cost * [0, 2, 4, 7, 11][one.rank + 1] - one.xp) : 0;
        const hint = us.some((u) => UNIT_DEFS[u.type].engineer) ? "<br>Inginer: click dreapta pe o clădire inamică / un puț de petrol = capturează; pe o clădire proprie avariată = repară."
          : us.some((u) => UNIT_DEFS[u.type].garrison) ? "<br>Click dreapta pe o casă: intră (max. 5). Ctrl + click dreapta: atac forțat." : "";
        key = `u${us.map((u) => u.id).join(",")}|${Math.round((hp / max) * 50)}|${us.map((u) => u.rank).join("")}|${one ? Math.round(one.xp) : vets}`;
        html = `<div class="ib-name">${one ? def!.name : `${us.length} unități`}${one?.rank ? ` <span class="rank r${one.rank}">${one.rank === 4 ? "★" : "›".repeat(one.rank)}</span>` : ""}</div>
          <div class="ib-hp"><div style="width:${(hp / max) * 100}%"></div></div>
          <div class="ib-row muted">${one ? `${RANK_NAMES[one.rank]}${one.rank < 4 ? ` · încă $${nextXp} distruși până la rangul următor` : " · se repară singur"}` : `Veterani: ${vets}`}${hint}</div>`;
      } else {
        key = "none";
        html = `<div class="ib-row muted">Selectează o clădire pentru reparare / vânzare.<br>Click dreapta cu o fabrică selectată: punct de adunare.<br>Infanteria poate ocupa casele; inginerii capturează clădiri și puțuri de petrol.</div>`;
      }
    }
    if (key !== infoKey) { info.innerHTML = html; infoKey = key; }
  };

  // ─── minimap ───
  const mm = document.getElementById("minimap") as HTMLCanvasElement;
  const ctx = mm.getContext("2d")!;
  const map = world.map;
  const bg = terrainImage(map);
  const S = mm.width / map.width;
  const toMini = (x: number, z: number) => [(x / map.cellSize) * S, mm.height - (z / map.cellSize) * S];
  const fromMini = (e: MouseEvent) => {
    const r = mm.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * mm.width, py = ((e.clientY - r.top) / r.height) * mm.height;
    return { x: (px / S) * map.cellSize, z: ((mm.height - py) / S) * map.cellSize };
  };
  let dragging = false;
  // camera privește spre +z: punctul țintă e în centrul ecranului → corecție mică spre sud
  const lookAtMini = (e: MouseEvent) => { const p = fromMini(e); cam.lookAt(p.x, p.z); };
  mm.addEventListener("pointerdown", (e) => {
    if (e.button === 0) { dragging = true; lookAtMini(e); mm.setPointerCapture(e.pointerId); }
    else if (e.button === 2) { const p = fromMini(e); input.commandAt(p.x, p.z); }
  });
  mm.addEventListener("pointermove", (e) => { if (dragging) lookAtMini(e); });
  mm.addEventListener("pointerup", () => { dragging = false; });
  mm.addEventListener("contextmenu", (e) => e.preventDefault());

  // stratul de ceață al minimap-ului (o imagine 96×96, scalată lin)
  const fogCanvas = document.createElement("canvas");
  fogCanvas.width = map.width;
  fogCanvas.height = map.height;
  const fogCtx = fogCanvas.getContext("2d")!;
  const fogImg = fogCtx.createImageData(map.width, map.height);
  let fogVersion = -1;
  const updateFog = () => {
    if (!vision || !vision.enabled || vision.version === fogVersion) return;
    fogVersion = vision.version;
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const v = vision.state[y * map.width + x];
        const o = ((map.height - 1 - y) * map.width + x) * 4;
        fogImg.data[o + 3] = v === Vis.Unexplored ? 255 : v === Vis.Fogged ? 120 : 0;
      }
    fogCtx.putImageData(fogImg, 0, 0);
  };
  const seesUnit = (u: { owner: number; x: number; z: number }) => !vision || u.owner === player || vision.isVisible(u.x, u.z);

  const drawMinimap = () => {
    ctx.drawImage(bg, 0, 0, mm.width, mm.height);
    // minereu rămas
    ctx.fillStyle = "#e7b53c";
    for (let i = 0; i < map.ore.length; i++) {
      if (map.ore[i] <= 0) continue;
      const cx = i % map.width, cy = (i / map.width) | 0;
      ctx.globalAlpha = 0.35 + 0.65 * (map.ore[i] / 500);
      ctx.fillRect(cx * S, mm.height - (cy + 1) * S, S, S);
    }
    ctx.globalAlpha = 1;
    for (const b of world.buildings.values()) {
      if (vision && !vision.buildingVisible(b)) continue;
      // casele libere sunt deja în imaginea terenului; cele ocupate / puțurile au culoarea proprietarului
      if (b.owner < 0 && !BUILDING_DEFS[b.type].capturable) continue;
      const f = FACTIONS[b.faction];
      ctx.fillStyle = f.primary;
      ctx.fillRect(b.cx * S, mm.height - (b.cy + b.ch) * S, b.cw * S, b.ch * S);
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.strokeRect(b.cx * S + 0.5, mm.height - (b.cy + b.ch) * S + 0.5, b.cw * S - 1, b.ch * S - 1);
    }
    for (const u of world.units.values()) {
      if (!seesUnit(u)) continue;
      const [x, y] = toMini(u.x, u.z);
      ctx.fillStyle = view.selected.has(u.id) ? "#ffffff" : FACTIONS[u.faction].primary;
      const s = UNIT_DEFS[u.type].radius > 1 ? 4 : 3;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    if (vision?.enabled) {
      updateFog();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fogCanvas, 0, 0, mm.width, mm.height);
      ctx.imageSmoothingEnabled = false;
    }
    // ping-ul atacului asupra bazei
    if (alertAt && performance.now() - alertAt.t < 3000) {
      const [x, y] = toMini(alertAt.x, alertAt.z);
      const k = ((performance.now() - alertAt.t) % 1000) / 1000;
      ctx.strokeStyle = `rgba(255,70,50,${1 - k})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4 + k * 14, 0, Math.PI * 2); ctx.stroke();
    }
    // ce vede camera (trapezul colțurilor ecranului pe sol)
    const c = document.getElementById("game")!.getBoundingClientRect();
    const corners = [[c.left, c.top], [c.right, c.top], [c.right, c.bottom], [c.left, c.bottom]].map(([x, y]) => input.groundPoint(x, y));
    if (corners.every((p) => p)) {
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((p, i) => { const [x, y] = toMini(p!.x, p!.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.stroke();
    }
  };

  // ─── „baza este atacată” ───
  let alertAt: { x: number; z: number; t: number } | null = null;
  let lastAlert = -1e9;

  // ─── energie + credite ───
  let wasLow = false;
  let lastBroke = 0;
  const updatePower = () => {
    const e = eco();
    const max = Math.max(e.powerOut, e.powerUse, 100);
    powerOut.style.width = `${(e.powerOut / max) * 100}%`;
    powerUse.style.width = `${(e.powerUse / max) * 100}%`;
    const low = isLowPower(e);
    root.classList.toggle("low-power", low);
    powerTxt.textContent = `⚡ ${e.powerUse} / ${e.powerOut}`;
    if (low && !wasLow) say("Energie insuficientă — producția încetinește", "warn", "error");
    wasLow = low;
    const waiting = CATEGORIES.some((c) => { const it = e.queues[c][0]; return it && !it.ready; }) && e.credits < 1;
    if (waiting && performance.now() - lastBroke > 12000) { say("Fonduri insuficiente", "warn", "error"); lastBroke = performance.now(); }
  };

  renderGrid();
  return {
    setIcon(item, url) {
      pics.set(item, url);
      const b = grid.querySelector<HTMLButtonElement>(`.cameo[data-item="${item}"]`);
      const old = b?.querySelector(".ico, .pic");
      if (old) old.outerHTML = picFor(item);
    },
    consume(events) {
      for (const ev of events) {
        if (ev.kind === "ready" && ev.player === player) {
          say(`${nameOf(ev.type)}: construcție finalizată — click pe pictogramă și plasează`, "ok", "ready");
          // trece automat pe tabul clădirii gata de plasat
          const c = categoryOf(ev.type)!;
          if (c !== cat) setTab(c);
        }
        if (ev.kind === "spawned" && ev.player === player) say(`${nameOf(ev.type)} pregătit`, "ok", "unitReady");
        if (ev.kind === "placed" && ev.player === player) renderGrid();
        if (ev.kind === "sold" && ev.player === player) { say(`${nameOf(ev.type)} vândută`, "", "sell"); renderGrid(); }
        if (ev.kind === "death" && ev.entity === "building") renderGrid();
        if (ev.kind === "hit" && ev.player === player && performance.now() - lastAlert > 15000) {
          lastAlert = performance.now();
          alertAt = { x: ev.x, z: ev.z, t: lastAlert };
          say(world.units.has(ev.id) ? "Recoltorul este atacat!" : "Baza este atacată!", "warn", "alarm");
        }
        if (ev.kind === "defeated" && ev.player !== player) say("Inamicul a fost învins!", "ok");
        if (ev.kind === "entered") {
          const b = world.buildings.get(ev.buildingId);
          const name = b ? BUILDING_DEFS[b.type].name : "Clădirea";
          if (ev.player === player && ev.action === "capture") { say(`${name}: capturat!`, "ok", "capture"); renderGrid(); }
          else if (ev.player !== player && ev.action === "capture" && ev.from === player) { say(`${name} a fost capturat de inamic!`, "warn", "alarm"); renderGrid(); }
          else if (ev.player === player && ev.action === "repair") say(`${name}: reparat de inginer`, "ok", "ready");
          else if (ev.player === player && ev.action === "garrison") audio.play("garrison", 0.8);
        }
        if (ev.kind === "promoted" && ev.player === player) {
          const u = world.findUnit(ev.id);
          say(`${u ? UNIT_DEFS[u.type].name : "Unitate"} promovat: ${RANK_NAMES[ev.rank]}`, "ok", "promote");
        }
      }
    },
    frame() {
      // creditele „curg” spre valoarea reală (ca în RA2)
      const target = Math.floor(eco().credits);
      shownCredits += (target - shownCredits) * 0.25;
      if (Math.abs(target - shownCredits) < 1) shownCredits = target;
      creditsEl.textContent = String(Math.round(shownCredits));
      if (++frames % 6 !== 0) return;
      updateGrid();
      updateInfo();
      updatePower();
      if (frames % 12 === 0 || (alertAt && performance.now() - alertAt.t < 3000)) drawMinimap();
      if (toastT && performance.now() - toastT > 4000) { toast.classList.remove("show"); toastT = 0; }
    },
  };
}

function terrainImage(m: GameMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = m.width;
  c.height = m.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(m.width, m.height);
  const col: Record<number, [number, number, number]> = {
    [Terrain.Grass]: [86, 124, 60],
    [Terrain.Water]: [47, 98, 128],
    [Terrain.Bridge]: [130, 126, 118],
    [Terrain.Sand]: [176, 160, 112],
    [Terrain.Ore]: [110, 120, 60],
  };
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      let [r, g, b] = col[m.terrain[i]] ?? [80, 80, 80];
      if (m.blocked[i] === 1) { r *= 0.62; g *= 0.72; b *= 0.62; }
      const o = ((m.height - 1 - y) * m.width + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}
