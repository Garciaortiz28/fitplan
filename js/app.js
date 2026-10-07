// Punto de entrada: carga datos base y enruta por hash (#/vista/param?query).
import { loadBase, store } from "./api.js";
import { $, $$, esc, toast } from "./util.js";
import { hideTip } from "./charts.js";

const VIEWS = {
  inicio: () => import("./views/dashboard.js"),
  entrenar: () => import("./views/train.js"),
  rutinas: () => import("./views/routines.js"),
  ejercicios: () => import("./views/catalog.js"),
  semana: () => import("./views/week.js"),
  progreso: () => import("./views/progress.js"),
  plan: () => import("./views/plan.js"),
  comer: () => import("./views/comer.js"),
  alimentos: () => import("./views/alimentos.js"),
  nutricion: () => import("./views/nutricion.js"),
};

// Secciones con pestañas (en el móvil se muestran como sub-navegación).
const GROUPS = {
  entreno: [["entrenar", "Entrenar"], ["rutinas", "Rutinas"], ["ejercicios", "Ejercicios"], ["semana", "Semana"]],
  nutri: [["comer", "Hoy"], ["alimentos", "Alimentos"], ["nutricion", "Historial"]],
};
const groupOf = (name) => Object.keys(GROUPS).find((g) => GROUPS[g].some(([k]) => k === name));

// Protección ante cambios sin guardar (la activan las vistas de edición).
export const guard = { dirty: false, message: "Tienes cambios sin guardar. ¿Salir de todos modos?" };
let currentHash = "";
let renderSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "inicio";
  const [path, qs = ""] = raw.split("?");
  const [name, ...params] = path.split("/").filter(Boolean);
  return { name: name || "inicio", params, query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function route() {
  if (guard.dirty && location.hash !== currentHash) {
    if (!window.confirm(guard.message)) {
      history.replaceState(null, "", currentHash || "#/inicio");
      return;
    }
    guard.dirty = false;
  }
  currentHash = location.hash;
  hideTip();
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.remove());
  const r = parseHash();
  // Si aún no hay perfil configurado, se guía al usuario a completarlo primero.
  if (!store.profile?.height_cm && r.name !== "plan" && r.name !== "ejercicios") {
    location.replace("#/plan?bienvenida=1");
    return;
  }
  const loader = VIEWS[r.name] || VIEWS.inicio;
  const group = groupOf(r.name);
  $$("#nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === r.name);
    a.classList.toggle("group-active", !!group && a.dataset.group === group && a.classList.contains("primary"));
  });
  const view = $("#view");
  const seq = ++renderSeq;
  view.innerHTML = `<div class="loading">Cargando…</div>`;
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;
    const container = document.createElement("div");
    view.replaceChildren(container);
    await mod.render(container, r);
    if (group && seq === renderSeq) {
      const sub = document.createElement("nav");
      sub.className = "subnav";
      sub.innerHTML = GROUPS[group].map(([k, l]) => `<a href="#/${k}" class="${k === r.name ? "on" : ""}">${esc(l)}</a>`).join("");
      view.prepend(sub);
    }
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="card"><h2>No se pudo cargar esta sección</h2>
      <p class="muted" style="margin-top:6px">${esc(err.message)}</p>
      <button class="btn" style="margin-top:12px" onclick="location.reload()">Reintentar</button></div>`;
  }
}

window.addEventListener("beforeunload", (e) => {
  if (guard.dirty) { e.preventDefault(); e.returnValue = ""; }
});
window.addEventListener("hashchange", route);

(async function start() {
  try {
    await loadBase();
  } catch (err) {
    const hint = store.mode === "local"
      ? "Comprueba tu conexión la primera vez que abres la app (después funciona sin internet) y vuelve a intentarlo."
      : "Ejecuta <b>Iniciar_FitPlan.bat</b> y recarga esta página.";
    $("#view").innerHTML = `<div class="card"><h2>No se pudo iniciar FitPlan</h2>
      <p class="muted" style="margin-top:6px">${esc(err.message)}</p>
      <p style="margin-top:10px">${hint}</p>
      <button class="btn" style="margin-top:12px" onclick="location.reload()">Reintentar</button></div>`;
    return;
  }
  route();
})();

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
export { toast };
