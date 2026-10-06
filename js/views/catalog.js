import { store } from "../api.js";
import { esc, debounce } from "../util.js";
import { filterExercises, exerciseCard, openExerciseDetail } from "../components.js";

const PAGE = 48;
// Los filtros se conservan al volver a la vista durante la sesión.
const state = { q: "", body_part: "", equipment: "", region: "", kind: "", impact: "", level: "", sort: "relevancia", myEquipment: false };

export async function render(el) {
  const m = store.meta;
  const opt = (list, all) => `<option value="">${all}</option>` + list.map((b) => `<option value="${b.key}">${esc(b.label)} (${b.count})</option>`).join("");
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Biblioteca de ejercicios</h1>
        <p>${m.total} ejercicios con animación, músculos implicados, gasto calórico y estímulo muscular.</p></div>
    </div>
    <div class="filters">
      <input class="search" id="q" type="search" placeholder="Buscar por nombre, músculo o patrón (p. ej. sentadilla, glúteos, remo)…" autocomplete="off">
      <select id="body_part" aria-label="Zona">${opt(m.body_parts, "Todas las zonas")}</select>
      <select id="region" aria-label="Músculo"><option value="">Todos los músculos</option>${m.regions.map((r) => `<option value="${r.key}">${esc(r.label)}</option>`).join("")}</select>
      <select id="equipment" aria-label="Equipamiento">${opt(m.equipment, "Todo el equipo")}</select>
      <select id="kind" aria-label="Tipo"><option value="">Todos los tipos</option><option value="fuerza">Fuerza</option><option value="cardio">Cardio</option><option value="flexibilidad">Movilidad</option></select>
      <select id="impact" aria-label="Impacto"><option value="">Cualquier impacto</option><option value="bajo">Impacto bajo</option><option value="medio">Impacto medio</option><option value="alto">Impacto alto</option></select>
      <select id="sort" aria-label="Ordenar"><option value="relevancia">Orden: relevancia</option><option value="nombre">Orden: nombre</option><option value="kcal">Más calorías</option><option value="musculo">Más estímulo muscular</option></select>
    </div>
    <div class="row between" style="margin-bottom:14px">
      <div class="row">
        <label class="check"><input type="checkbox" id="myEquipment"> Solo con mi equipamiento</label>
        <select id="level" style="width:auto" aria-label="Nivel"><option value="">Cualquier nivel</option><option value="principiante">Hasta principiante</option><option value="intermedio">Hasta intermedio</option></select>
      </div>
      <span class="muted small" id="count"></span>
    </div>
    <div class="ex-grid" id="grid"></div>
    <div style="text-align:center;margin-top:18px"><button class="btn" id="more" hidden>Mostrar más</button></div>`;

  const $ = (s) => el.querySelector(s);
  for (const k of Object.keys(state)) {
    const input = $(`#${k}`);
    if (!input) continue;
    if (input.type === "checkbox") input.checked = state[k]; else input.value = state[k];
  }
  let list = [], shown = 0;
  const grid = $("#grid");

  const draw = (reset = true) => {
    if (reset) {
      list = filterExercises(store.exercises, state);
      shown = 0;
      grid.innerHTML = "";
    }
    const next = list.slice(shown, shown + PAGE);
    grid.insertAdjacentHTML("beforeend", next.map(exerciseCard).join(""));
    shown += next.length;
    $("#count").textContent = `${list.length} ejercicios`;
    $("#more").hidden = shown >= list.length;
    if (!list.length) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Sin resultados</h3><p>Prueba con otros filtros o términos de búsqueda.</p></div>`;
  };

  const update = () => {
    for (const k of Object.keys(state)) {
      const input = $(`#${k}`);
      if (input) state[k] = input.type === "checkbox" ? input.checked : input.value;
    }
    draw(true);
  };
  $("#q").addEventListener("input", debounce(update, 180));
  ["#body_part", "#region", "#equipment", "#kind", "#impact", "#sort", "#myEquipment", "#level"]
    .forEach((s) => $(s).addEventListener("change", update));
  $("#more").addEventListener("click", () => draw(false));
  grid.addEventListener("click", (e) => {
    const c = e.target.closest("[data-ex]");
    if (c) openExerciseDetail(c.dataset.ex);
  });
  grid.addEventListener("keydown", (e) => {
    const c = e.target.closest("[data-ex]");
    if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openExerciseDetail(c.dataset.ex); }
  });
  if (!store.profile?.equipment?.length) $("#myEquipment").disabled = true;
  draw(true);
}
