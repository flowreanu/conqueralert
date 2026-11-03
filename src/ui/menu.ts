import factionsData from "../data/factions.json";
import type { Difficulty } from "../sim/scenario";
import type { World } from "../sim/world";

const FACTIONS = factionsData as Record<string, { name: string; primary: string; secondary: string }>;

export interface GameSettings {
  faction: "usa" | "ussr";
  difficulty: Difficulty;
  fog: boolean;
}

const STORE = "ca-settings";
const AUTOSTART = "ca-autostart";

const load = (): GameSettings => {
  const def: GameSettings = { faction: "usa", difficulty: "normal", fog: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") }; } catch { return def; }
};
const save = (s: GameSettings) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* fără stocare */ } };

/** „Joacă din nou”: setările trec prin sessionStorage peste un reload (cel mai curat mod de a reporni scena). */
export function restart(s: GameSettings) {
  try { sessionStorage.setItem(AUTOSTART, JSON.stringify(s)); } catch { /* fără stocare → meniul apare din nou */ }
  location.reload();
}
export function backToMenu() {
  try { sessionStorage.removeItem(AUTOSTART); } catch { /* */ }
  location.reload();
}

const FACTION_INFO: Record<string, { motto: string; units: string }> = {
  usa: { motto: "Rapizi și preciși", units: "Ranger · Tanc Liberty · Sentinel (artilerie)" },
  ussr: { motto: "Blindaj greu, foc masiv", units: "Conscript · Tanc Ursus · Katiușa (rachete)" },
};
const DIFFS: { id: Difficulty; name: string; desc: string }[] = [
  { id: "easy", name: "Ușor", desc: "atacă rar, cu grupuri mici" },
  { id: "normal", name: "Normal", desc: "un adversar echilibrat" },
  { id: "hard", name: "Greu", desc: "valuri mari, venit +30%" },
];

/** Meniul principal: alegerea facțiunii, a dificultății și a ceții. Se rezolvă la „Start”. */
export function showMenu(): Promise<GameSettings> {
  try {
    const auto = sessionStorage.getItem(AUTOSTART);
    if (auto) { sessionStorage.removeItem(AUTOSTART); return Promise.resolve({ ...load(), ...JSON.parse(auto) }); }
  } catch { /* */ }
  const s = load();
  const el = document.createElement("div");
  el.className = "overlay menu";
  document.body.appendChild(el);
  const render = () => {
    el.innerHTML = `
      <div class="panel">
        <h1>ConquerAlert</h1>
        <div class="sub">Skirmish 1 contra 1 · harta „Delta Dunării”</div>
        <h2>Facțiunea ta</h2>
        <div class="cards">${(["usa", "ussr"] as const).map((f) => `
          <button class="card ${s.faction === f ? "on" : ""}" data-faction="${f}" style="--c:${FACTIONS[f].primary}">
            <span class="flag"></span><b>${FACTIONS[f].name}</b><span class="motto">${FACTION_INFO[f].motto}</span><span class="units">${FACTION_INFO[f].units}</span>
          </button>`).join("")}
        </div>
        <h2>Adversar (bot)</h2>
        <div class="diffs">${DIFFS.map((d) => `<button class="diff ${s.difficulty === d.id ? "on" : ""}" data-diff="${d.id}"><b>${d.name}</b><span>${d.desc}</span></button>`).join("")}</div>
        <label class="opt"><input type="checkbox" id="opt-fog" ${s.fog ? "checked" : ""}/> Ceață de război</label>
        <button class="start" id="start">Start</button>
        <div class="hint">Distruge toate clădirile și unitățile inamicului. Japonia vine într-o versiune viitoare.</div>
      </div>`;
  };
  render();
  return new Promise((resolve) => {
    el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const f = t.closest<HTMLElement>("[data-faction]")?.dataset.faction;
      const d = t.closest<HTMLElement>("[data-diff]")?.dataset.diff;
      if (f) { s.faction = f as GameSettings["faction"]; render(); }
      if (d) { s.difficulty = d as Difficulty; render(); }
      if (t.id === "opt-fog") s.fog = (t as HTMLInputElement).checked;
      if (t.closest("#start")) { save(s); el.remove(); resolve(s); }
    });
  });
}

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Ecranul de final: victorie / înfrângere + statistici. */
export function showEndScreen(world: World, player: number, seconds: number, settings: GameSettings) {
  const won = world.winner === player;
  const el = document.createElement("div");
  el.className = `overlay end ${won ? "won" : "lost"}`;
  const rows: [string, (p: number) => number][] = [
    ["Unități produse", (p) => world.stats[p].unitsBuilt],
    ["Unități pierdute", (p) => world.stats[p].unitsLost],
    ["Unități distruse", (p) => world.stats[p].unitsKilled],
    ["Clădiri construite", (p) => world.stats[p].buildingsBuilt],
    ["Clădiri distruse", (p) => world.stats[p].buildingsKilled],
    ["Credite recoltate", (p) => Math.round(world.eco[p].harvested)],
  ];
  el.innerHTML = `
    <div class="panel">
      <h1>${won ? "Victorie" : "Înfrângere"}</h1>
      <div class="sub">Durata meciului: ${fmtTime(seconds)}</div>
      <table>
        <tr><th></th>${world.players.map((p) => `<th style="color:${FACTIONS[p.faction].primary}">${p.index === player ? "Tu" : "Bot"} · ${FACTIONS[p.faction].name}</th>`).join("")}</tr>
        ${rows.map(([n, f]) => `<tr><td>${n}</td>${world.players.map((p) => `<td>${f(p.index)}</td>`).join("")}</tr>`).join("")}
      </table>
      <div class="btns"><button class="start" data-act="again">Joacă din nou</button><button data-act="menu">Meniu</button></div>
    </div>`;
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (a === "again") restart(settings);
    if (a === "menu") backToMenu();
  });
  document.body.appendChild(el);
}

/** Pauza (P / butonul „Meniu”): continuă, reîncepe, abandonează. */
export function createPauseMenu(onResume: () => void, onSurrender: () => void, settings: GameSettings) {
  const el = document.createElement("div");
  el.className = "overlay pause";
  el.style.display = "none";
  el.innerHTML = `
    <div class="panel small">
      <h1>Pauză</h1>
      <div class="btns col">
        <button class="start" data-act="resume">Continuă</button>
        <button data-act="restart">Reîncepe meciul</button>
        <button data-act="surrender" class="danger">Abandonează</button>
        <button data-act="menu">Meniul principal</button>
      </div>
      <div class="hint">P / Esc: continuă</div>
    </div>`;
  el.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (a === "resume") onResume();
    if (a === "restart") restart(settings);
    if (a === "surrender") onSurrender();
    if (a === "menu") backToMenu();
  });
  document.body.appendChild(el);
  return {
    show(v: boolean) { el.style.display = v ? "grid" : "none"; },
    get visible() { return el.style.display !== "none"; },
  };
}
