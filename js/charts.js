// Gráficos SVG ligeros, sin dependencias externas. Se redibujan al cambiar el ancho.
import { esc, fmt } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const tipEl = () => document.getElementById("tooltip");

export function showTip(evt, html) {
  const t = tipEl();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
let clearActive = null; // limpia el resaltado del elemento activo al ocultar el tooltip
export const hideTip = () => {
  tipEl().hidden = true;
  if (clearActive) { clearActive(); clearActive = null; }
};

/**
 * Asocia un tooltip a un elemento con ratón (hover) y táctil (toque).
 * show(e) muestra; onClear() quita el resaltado propio.
 */
export function bindTip(el, show, onClear) {
  const activate = (e) => {
    if (clearActive && clearActive !== onClear) clearActive();
    clearActive = onClear || null;
    show(e);
  };
  el.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") activate(e); });
  el.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") activate(e); });
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
}
// En pantallas táctiles el tooltip se cierra al tocar fuera o al desplazarse.
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" && !e.target.closest?.(".chart svg, .bodymap")) hideTip();
}, { passive: true });
window.addEventListener("scroll", () => { if (!tipEl().hidden) hideTip(); }, { passive: true });

export function tipHTML(title, rows) {
  return `<div class="t-title">${esc(title)}</div>` +
    rows.map(([k, v]) => `<div class="t-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function responsive(el, draw) {
  if (el._ro) el._ro.disconnect();
  let lastW = 0;
  const run = () => {
    const w = Math.round(el.clientWidth);
    if (w > 0 && w !== lastW) { lastW = w; draw(w); }
  };
  el._ro = new ResizeObserver(run);
  el._ro.observe(el);
  run();
}

function svg(w, h) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${w} ${h}`);
  s.setAttribute("width", w);
  s.setAttribute("height", h);
  s.setAttribute("role", "img");
  return s;
}
function node(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
}
// Barra con extremo de datos redondeado (4px) y anclada a la línea base.
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Columnas verticales.
 * data: [{label, value, title, rows:[[k,v]]}]
 * opts: {color, unit, height, target, targetLabel, ariaLabel, labelEvery}
 */
export function barChart(el, data, opts = {}) {
  const { color = "var(--accent)", unit = "", height = 220, target = null, targetLabel = "Objetivo" } = opts;
  el.classList.add("chart");
  if (!data.length) { el.innerHTML = `<div class="chart-empty">Sin datos todavía.</div>`; return; }
  responsive(el, (W) => {
    const m = { t: 18, r: 12, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = height - m.t - m.b;
    const max = niceMax(Math.max(target || 0, ...data.map((d) => d.value)) * 1.08);
    const y = (v) => m.t + ih - (v / max) * ih;
    const band = iw / data.length;
    const bw = Math.max(4, Math.min(44, band * 0.62));
    const s = svg(W, height);
    s.setAttribute("aria-label", opts.ariaLabel || "Gráfico de barras");

    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      node("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "baseline" }, s);
      node("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end", class: "tick" }, s).textContent = fmt.int(v);
    }
    const every = opts.labelEvery || Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));
    const maxIdx = data.reduce((bi, d, i) => (d.value > data[bi].value ? i : bi), 0);
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const col = node("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, class: "hover-col" }, s);
      if (d.value > 0) {
        node("path", { d: barPath(cx - bw / 2, y(d.value), bw, y(0) - y(d.value)), fill: color }, s);
      }
      if (i % every === 0 || i === data.length - 1) {
        node("text", { x: cx, y: height - 8, "text-anchor": "middle", class: "tick" }, s).textContent = d.label;
      }
      // Etiqueta directa solo en el máximo (rotulado selectivo).
      if (i === maxIdx && d.value > 0 && opts.labelMax !== false) {
        node("text", { x: cx, y: y(d.value) - 6, class: "dlabel" }, s).textContent = fmt.int(d.value);
      }
      const hit = node("rect", { x: m.l + band * i, y: m.t, width: band, height: ih + m.b, class: "hit" }, s);
      const rows = d.rows || [[unit || "Valor", fmt.int(d.value)]];
      bindTip(hit, (e) => { col.classList.add("on"); showTip(e, tipHTML(d.title || d.label, rows)); },
        () => col.classList.remove("on"));
    });
    if (target) {
      const ty = y(target);
      node("line", { x1: m.l, x2: W - m.r, y1: ty, y2: ty, class: "target" }, s);
      node("text", { x: W - m.r, y: ty - 6, "text-anchor": "end", class: "target-label" }, s)
        .textContent = `${targetLabel}: ${fmt.int(target)}`;
    }
    el.replaceChildren(s);
  });
}

/**
 * Línea temporal con crosshair.
 * points: [{x: 'AAAA-MM-DD', y}]; opts: {color, unit, height, goal, goalLabel, decimals}
 */
export function lineChart(el, points, opts = {}) {
  const { color = "var(--accent)", unit = "", height = 240, goal = null, goalLabel = "Objetivo" } = opts;
  el.classList.add("chart");
  if (!points.length) { el.innerHTML = `<div class="chart-empty">${esc(opts.empty || "Sin datos todavía.")}</div>`; return; }
  const f = opts.decimals ? fmt.dec : fmt.int;
  responsive(el, (W) => {
    const m = { t: 18, r: 16, b: 26, l: 46 };
    const iw = W - m.l - m.r, ih = height - m.t - m.b;
    const ts = points.map((p) => new Date(p.x + "T12:00:00").getTime());
    let t0 = Math.min(...ts), t1 = Math.max(...ts);
    // Rango mínimo de 6 días para que las etiquetas de fecha no se repitan.
    if (t1 - t0 < 6 * 86400000) { const c = (t0 + t1) / 2; t0 = c - 3 * 86400000; t1 = c + 3 * 86400000; }
    const vals = points.map((p) => p.y).concat(goal != null ? [goal] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padV = Math.max(1, (hi - lo) * 0.15);
    lo = Math.floor(lo - padV); hi = Math.ceil(hi + padV);
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    const s = svg(W, height);
    s.setAttribute("aria-label", opts.ariaLabel || "Gráfico de evolución");

    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) / 4) * i, yy = y(v);
      node("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "baseline" }, s);
      node("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end", class: "tick" }, s).textContent = f(v);
    }
    const nTicks = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    for (let i = 0; i < nTicks; i++) {
      const t = t0 + ((t1 - t0) / (nTicks - 1)) * i;
      const d = new Date(t);
      node("text", { x: x(t), y: height - 8, "text-anchor": i === 0 ? "start" : i === nTicks - 1 ? "end" : "middle", class: "tick" }, s)
        .textContent = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    }
    if (goal != null) {
      const gy = y(goal);
      node("line", { x1: m.l, x2: W - m.r, y1: gy, y2: gy, class: "target" }, s);
      node("text", { x: W - m.r, y: gy - 6, "text-anchor": "end", class: "target-label" }, s)
        .textContent = `${goalLabel}: ${f(goal)}${unit ? " " + unit : ""}`;
    }
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
    node("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
    if (points.length <= 40) {
      points.forEach((p, i) => node("circle", { cx: x(ts[i]), cy: y(p.y), r: 4, fill: color, stroke: "var(--surface)", "stroke-width": 2 }, s));
    }
    // Último valor rotulado directamente.
    const li = points.length - 1;
    node("text", { x: Math.min(x(ts[li]), W - m.r - 20), y: y(points[li].y) - 10, class: "dlabel" }, s).textContent = f(points[li].y);

    const cross = node("line", { y1: m.t, y2: m.t + ih, stroke: "var(--axis)", "stroke-width": 1, opacity: 0 }, s);
    const dot = node("circle", { r: 5, fill: color, stroke: "var(--surface)", "stroke-width": 2, opacity: 0 }, s);
    const hit = node("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "hit" }, s);
    bindTip(hit, (e) => {
      const rect = s.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * W;
      let bi = 0;
      ts.forEach((t, i) => { if (Math.abs(x(t) - mx) < Math.abs(x(ts[bi]) - mx)) bi = i; });
      const px = x(ts[bi]), py = y(points[bi].y);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("opacity", 1);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("opacity", 1);
      const rows = points[bi].rows || [[unit || "Valor", `${f(points[bi].y)}${unit ? " " + unit : ""}`]];
      showTip(e, tipHTML(fmt.date(points[bi].x), rows));
    }, () => { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
    el.replaceChildren(s);
  });
}

/**
 * Varias series temporales con escala común (p. ej. peso esperado vs. real).
 * series: [{name, color, dashed, points:[{x:'AAAA-MM-DD', y}]}]; opts: {unit, height, decimals}
 */
export function multiLineChart(el, series, opts = {}) {
  const { unit = "", height = 260 } = opts;
  el.classList.add("chart");
  const all = series.flatMap((s) => s.points);
  if (!all.length) { el.innerHTML = `<div class="chart-empty">${esc(opts.empty || "Sin datos todavía.")}</div>`; return; }
  const f = opts.decimals ? fmt.dec : fmt.int;
  const T = (x) => new Date(x + "T12:00:00").getTime();
  responsive(el, (W) => {
    const m = { t: 30, r: 16, b: 26, l: 46 };
    const iw = W - m.l - m.r, ih = height - m.t - m.b;
    let t0 = Math.min(...all.map((p) => T(p.x))), t1 = Math.max(...all.map((p) => T(p.x)));
    // Rango mínimo de 6 días para que las etiquetas de fecha no se repitan.
    if (t1 - t0 < 6 * 86400000) { const c = (t0 + t1) / 2; t0 = c - 3 * 86400000; t1 = c + 3 * 86400000; }
    let lo = Math.min(...all.map((p) => p.y)), hi = Math.max(...all.map((p) => p.y));
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad);
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    const s = svg(W, height);
    s.setAttribute("aria-label", opts.ariaLabel || "Gráfico de series");
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) / 4) * i, yy = y(v);
      node("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "gridline" : "baseline" }, s);
      node("text", { x: m.l - 8, y: yy + 4, "text-anchor": "end", class: "tick" }, s).textContent = f(v);
    }
    const nT = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    for (let i = 0; i < nT; i++) {
      const t = t0 + ((t1 - t0) / (nT - 1)) * i;
      node("text", { x: x(t), y: height - 8, "text-anchor": i === 0 ? "start" : i === nT - 1 ? "end" : "middle", class: "tick" }, s)
        .textContent = new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
    }
    // Leyenda (identidad nunca solo por color: cada serie tiene nombre y estilo de trazo).
    let lx = m.l;
    series.forEach((se) => {
      node("line", { x1: lx, x2: lx + 22, y1: 10, y2: 10, stroke: se.color, "stroke-width": 2, "stroke-dasharray": se.dashed ? "5 4" : "" }, s);
      const tx = node("text", { x: lx + 28, y: 14, class: "tick" }, s);
      tx.textContent = se.name;
      lx += 40 + se.name.length * 6.5;
    });
    series.forEach((se) => {
      if (!se.points.length) return;
      const d = se.points.map((p, i) => `${i ? "L" : "M"}${x(T(p.x)).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
      node("path", { d, fill: "none", stroke: se.color, "stroke-width": 2, "stroke-dasharray": se.dashed ? "6 4" : "", "stroke-linejoin": "round" }, s);
      if (!se.dashed && se.points.length <= 40) se.points.forEach((p) => node("circle", { cx: x(T(p.x)), cy: y(p.y), r: 4, fill: se.color, stroke: "var(--surface)", "stroke-width": 2 }, s));
    });
    const cross = node("line", { y1: m.t, y2: m.t + ih, stroke: "var(--axis)", "stroke-width": 1, opacity: 0 }, s);
    const hit = node("rect", { x: m.l, y: m.t, width: iw, height: ih, class: "hit" }, s);
    bindTip(hit, (e) => {
      const rect = s.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * W;
      const t = t0 + ((mx - m.l) / iw) * (t1 - t0);
      cross.setAttribute("x1", mx); cross.setAttribute("x2", mx); cross.setAttribute("opacity", 1);
      const rows = series.map((se) => {
        if (!se.points.length) return [se.name, "–"];
        const near = se.points.reduce((b, p) => (Math.abs(T(p.x) - t) < Math.abs(T(b.x) - t) ? p : b));
        return [se.name, Math.abs(T(near.x) - t) < 5 * 86400000 ? `${f(near.y)}${unit ? " " + unit : ""}` : "–"];
      });
      showTip(e, tipHTML(new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }), rows));
    }, () => cross.setAttribute("opacity", 0));
    el.replaceChildren(s);
  });
}

/** Barras horizontales en HTML (ranking). data: [{label, value, display}] */
export function hbars(data, { color = "var(--accent)", unit = "" } = {}) {
  if (!data.length) return `<div class="chart-empty">Sin datos todavía.</div>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  return data.map((d) => `
    <div class="hbar" title="${esc(d.label)}: ${esc(d.display ?? fmt.int(d.value))} ${esc(unit)}">
      <span class="nowrap" style="overflow:hidden;text-overflow:ellipsis">${esc(d.label)}</span>
      <div class="track"><span style="width:${(d.value / max) * 100}%;background:${color}"></span></div>
      <span class="v">${esc(d.display ?? fmt.int(d.value))}${unit ? " " + esc(unit) : ""}</span>
    </div>`).join("");
}
