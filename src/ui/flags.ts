/** Steagurile facțiunilor (SVG, proporție 3:2). */
const usa = () => {
  const stripes = Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? `<rect y="${(i * 20) / 13}" width="30" height="${20 / 13 + 0.02}" fill="#b22234"/>` : "")).join("");
  const stars: string[] = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++)
    stars.push(`<circle cx="${1.05 + c * 2.1 + (r % 2 ? 1.05 : 0)}" cy="${0.95 + r * 1.17}" r="0.36"/>`);
  return `<rect width="30" height="20" fill="#fff"/>${stripes}<rect width="13" height="${(20 * 7) / 13}" fill="#3c3b6e"/><g fill="#fff">${stars.join("")}</g>`;
};
const ussr = () =>
  `<rect width="30" height="20" fill="#cc0000"/>
   <g fill="none" stroke="#ffd700" stroke-linecap="round">
     <path d="M4.1 2.15 l0.33 1 h1.05 l-0.85 0.62 0.33 1 -0.86 -0.62 -0.86 0.62 0.33 -1 -0.85 -0.62 h1.05z" fill="#ffd700" stroke="none" transform="translate(0.3 0)"/>
     <path d="M6.3 6.5 A2.25 2.25 0 1 0 6.5 10.5 L4.6 11.9" stroke-width="0.75"/>
     <path d="M3.5 11.7 L7.0 8.2" stroke-width="0.7"/>
     <path d="M6.1 7.2 L7.9 9.0" stroke-width="1.15" stroke-linecap="butt"/>
   </g>`;

export function flagSvg(faction: string, cls = "flag-svg") {
  const body = faction === "ussr" ? ussr() : faction === "usa" ? usa() : `<rect width="30" height="20" fill="#eee"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>`;
  return `<svg class="${cls}" viewBox="0 0 30 20" preserveAspectRatio="none">${body}</svg>`;
}
