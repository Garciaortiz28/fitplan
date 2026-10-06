// Mapa corporal (frente y espalda) con regiones musculares coloreadas.
import { esc, fmt } from "./util.js";
import { showTip, bindTip, tipHTML } from "./charts.js";
import { regionLabel } from "./api.js";

// Coordenadas en un lienzo de 200×432; cada región se dibuja en ambos lados del cuerpo.
const FRONT = [
  ["cuello", `<rect x="90" y="56" width="20" height="16" rx="4"/>`],
  ["hombros", `<ellipse cx="63" cy="92" rx="16" ry="13"/><ellipse cx="137" cy="92" rx="16" ry="13"/>`],
  ["pecho", `<path d="M70,82 Q85,76 99,80 L99,118 Q84,124 70,114 Z"/><path d="M130,82 Q115,76 101,80 L101,118 Q116,124 130,114 Z"/>`],
  ["biceps", `<ellipse cx="54" cy="128" rx="10" ry="21"/><ellipse cx="146" cy="128" rx="10" ry="21"/>`],
  ["antebrazos", `<ellipse cx="47" cy="178" rx="9" ry="25"/><ellipse cx="153" cy="178" rx="9" ry="25"/>`],
  ["abdomen", `<rect x="86" y="124" width="28" height="70" rx="8"/>`],
  ["oblicuos", `<path d="M72,122 L83,124 L83,192 L76,196 Q70,160 72,122 Z"/><path d="M128,122 L117,124 L117,192 L124,196 Q130,160 128,122 Z"/>`],
  ["abductores", `<ellipse cx="72" cy="214" rx="7" ry="13"/><ellipse cx="128" cy="214" rx="7" ry="13"/>`],
  ["cuadriceps", `<ellipse cx="82" cy="262" rx="13" ry="42"/><ellipse cx="118" cy="262" rx="13" ry="42"/>`],
  ["aductores", `<ellipse cx="97" cy="244" rx="3.6" ry="22"/><ellipse cx="103" cy="244" rx="3.6" ry="22"/>`],
  ["gemelos", `<ellipse cx="83" cy="350" rx="10" ry="30"/><ellipse cx="117" cy="350" rx="10" ry="30"/>`],
];
const FRONT_SHAPES = `
  <circle cx="100" cy="32" r="22"/>
  <ellipse cx="44" cy="214" rx="7" ry="10"/><ellipse cx="156" cy="214" rx="7" ry="10"/>
  <path d="M84,196 L116,196 L112,216 L88,216 Z"/>
  <circle cx="83" cy="312" r="8"/><circle cx="117" cy="312" r="8"/>
  <ellipse cx="82" cy="394" rx="10" ry="6"/><ellipse cx="118" cy="394" rx="10" ry="6"/>`;

const BACK = [
  ["cuello", `<rect x="90" y="56" width="20" height="10" rx="4"/>`],
  ["trapecios", `<path d="M86,64 L114,64 L136,84 L114,96 L100,108 L86,96 L64,84 Z"/>`],
  ["hombros", `<ellipse cx="63" cy="92" rx="16" ry="13"/><ellipse cx="137" cy="92" rx="16" ry="13"/>`],
  ["triceps", `<ellipse cx="54" cy="128" rx="10" ry="21"/><ellipse cx="146" cy="128" rx="10" ry="21"/>`],
  ["antebrazos", `<ellipse cx="47" cy="178" rx="9" ry="25"/><ellipse cx="153" cy="178" rx="9" ry="25"/>`],
  ["dorsales", `<path d="M70,98 L96,104 L96,150 Q84,160 74,150 Q68,120 70,98 Z"/><path d="M130,98 L104,104 L104,150 Q116,160 126,150 Q132,120 130,98 Z"/>`],
  ["espalda_alta", `<path d="M86,98 L100,110 L114,98 L114,120 L100,128 L86,120 Z"/>`],
  ["lumbar", `<rect x="88" y="154" width="24" height="38" rx="6"/>`],
  ["gluteos", `<ellipse cx="89" cy="212" rx="13" ry="16"/><ellipse cx="111" cy="212" rx="13" ry="16"/>`],
  ["isquios", `<ellipse cx="84" cy="270" rx="13" ry="38"/><ellipse cx="116" cy="270" rx="13" ry="38"/>`],
  ["gemelos", `<ellipse cx="84" cy="345" rx="11" ry="28"/><ellipse cx="116" cy="345" rx="11" ry="28"/>`],
];
const BACK_SHAPES = `
  <circle cx="100" cy="32" r="22"/>
  <ellipse cx="44" cy="214" rx="7" ry="10"/><ellipse cx="156" cy="214" rx="7" ry="10"/>
  <circle cx="84" cy="312" r="7"/><circle cx="116" cy="312" r="7"/>
  <ellipse cx="82" cy="394" rx="10" ry="6"/><ellipse cx="118" cy="394" rx="10" ry="6"/>`;

function figure(regions, shapes, caption) {
  return `<svg viewBox="0 0 200 432" aria-label="${esc(caption)}">
    <g class="shape">${shapes}</g>
    ${regions.map(([k, d]) => `<g class="region" data-region="${k}">${d}</g>`).join("")}
    <text x="100" y="426" class="cap">${esc(caption)}</text>
  </svg>`;
}

/**
 * Renderiza el mapa.
 * mode "load": values = {region: series}, escala secuencial de 5 pasos.
 * mode "exercise": values = {primary: 'region', secondary: ['region', ...]}.
 */
export function renderBodyMap(el, values, { mode = "load", unit = "series" } = {}) {
  el.innerHTML = `<div class="bodymap">${figure(FRONT, FRONT_SHAPES, "Frente")}${figure(BACK, BACK_SHAPES, "Espalda")}</div>
    <div class="legend"></div>`;
  const legend = el.querySelector(".legend");
  let colorOf, tipOf;

  if (mode === "exercise") {
    const sec = new Set(values.secondary || []);
    colorOf = (k) => (k === values.primary ? "var(--seq-4)" : sec.has(k) ? "var(--seq-2)" : "var(--seq-0)");
    tipOf = (k) => tipHTML(regionLabel(k), [["Implicación", k === values.primary ? "Principal" : sec.has(k) ? "Secundaria" : "—"]]);
    legend.innerHTML = `<span><span class="sw" style="background:var(--seq-4)"></span>Principal</span>
      <span><span class="sw" style="background:var(--seq-2)"></span>Secundario</span>`;
  } else {
    const max = Math.max(0, ...Object.entries(values).filter(([k]) => k !== "cardio").map(([, v]) => v));
    const step = (v) => (!v || !max ? 0 : Math.max(1, Math.ceil((v / max) * 5)));
    colorOf = (k) => `var(--seq-${step(values[k] || 0)})`;
    tipOf = (k) => tipHTML(regionLabel(k), [[unit === "series" ? "Series" : unit, fmt.dec(values[k] || 0)]]);
    legend.innerHTML = max
      ? `<span>Menos</span><span class="ramp">${[1, 2, 3, 4, 5].map((i) => `<span style="background:var(--seq-${i})"></span>`).join("")}</span><span>Más ${unit}</span>`
      : `<span class="muted">Aún no hay series registradas.</span>`;
  }

  el.querySelectorAll(".region").forEach((g) => {
    const k = g.dataset.region;
    g.style.fill = colorOf(k);
    bindTip(g, (e) => showTip(e, tipOf(k)));
  });
}
