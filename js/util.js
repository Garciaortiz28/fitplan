// Utilidades compartidas: DOM, formato, fechas, avisos y diálogos.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmt = {
  int: (n) => (n == null || isNaN(n) ? "–" : nf0.format(Math.round(n))),
  dec: (n) => (n == null || isNaN(n) ? "–" : nf1.format(n)),
  kg: (n) => (n == null || isNaN(n) ? "–" : `${nf1.format(n)} kg`),
  dur: (sec) => {
    sec = Math.round(sec || 0);
    const m = Math.floor(sec / 60), s = sec % 60;
    return s ? `${m}:${String(s).padStart(2, "0")}` : `${m} min`;
  },
  date: (iso) => {
    if (!iso) return "–";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  },
  dateLong: (iso) =>
    parseISO(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }),
  dayMonth: (iso) => parseISO(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
};

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

// ----- Fechas (siempre en hora local, nunca UTC) -----
export function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function weekStartISO(iso) {
  const d = parseISO(iso);
  const wd = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - wd);
  return toISO(d);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ----- Avisos -----
export function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3200);
}

// ----- Modal -----
export function openModal({ title, html, wide = false, footer = "" }) {
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  back.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2>
        <button class="btn ghost icon" data-close aria-label="Cerrar">${ICON.x}</button></div>
      <div class="modal-body">${html}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </div>`;
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  back.addEventListener("mousedown", (e) => e.target === back && close());
  back.querySelector("[data-close]").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  return { el: back.querySelector(".modal"), close };
}

export function confirmDialog(message, { ok = "Confirmar", danger = false } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title: "Confirmar",
      html: `<p>${esc(message)}</p>`,
      footer: `<button class="btn" data-no>Cancelar</button>
               <button class="btn ${danger ? "primary" : "primary"}" data-yes>${esc(ok)}</button>`,
    });
    let done = false;
    const finish = (v) => { if (!done) { done = true; m.close(); resolve(v); } };
    m.el.querySelector("[data-yes]").onclick = () => finish(true);
    m.el.querySelector("[data-no]").onclick = () => finish(false);
    m.el.querySelector("[data-close]").addEventListener("click", () => finish(false));
  });
}

export function emptyState(title, text, action = "") {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div>`;
}

export const ICON = {
  x: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
  left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`,
  right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>`,
};
