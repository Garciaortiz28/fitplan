import { api, store, regionLabel } from "../api.js";
import { esc, fmt, toast, confirmDialog, debounce, emptyState, ICON } from "../util.js";
import { hbars } from "../charts.js";
import { renderBodyMap } from "../bodymap.js";
import { openPicker, openExerciseDetail } from "../components.js";
import { guard, navigate } from "../app.js";

let pendingDraft = null; // rutina sugerida pendiente de abrir en el editor

const ITEM_FIELDS = ["exercise_id", "sets", "reps", "duration_sec", "rest_sec", "weight_kg", "notes"];
const cleanItem = (it) => Object.fromEntries(ITEM_FIELDS.map((k) => [k, it[k] ?? (k === "notes" ? "" : 0)]));

export async function render(el, r) {
  if (r.params[0] === "nueva") return editor(el, null, r.query);
  if (r.params[0] === "editar" && r.params[1]) return editor(el, Number(r.params[1]), r.query);
  return list(el);
}

// ---------------------------------------------------------------- listado
async function list(el) {
  const [routines, plans] = await Promise.all([api.get("/api/routines"), api.get("/api/plans")]);
  const active = plans.find((p) => p.active);
  const usedBy = new Map();
  if (active) Object.entries(active.schedule).forEach(([wd, rid]) => {
    usedBy.set(rid, [...(usedBy.get(rid) || []), store.meta.weekdays[wd].slice(0, 3)]);
  });
  const tpls = store.meta.templates;
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Rutinas</h1><p>Crea tus rutinas a medida o genera una propuesta adaptada a tu perfil y equipamiento.</p></div>
      <a class="btn primary" href="#/rutinas/nueva">${ICON.plus}Nueva rutina</a>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${ICON.spark} Generar rutina sugerida</h2>
        <div class="sub">Prioriza ejercicios básicos y seguros, según tu nivel (${esc(store.profile.level)}), impacto y equipamiento.</div></div></div>
      <div class="row">
        <label class="field" style="flex:2;min-width:180px">Tipo de sesión
          <select id="tpl">${tpls.map((t) => `<option value="${t.key}">${esc(t.name)}</option>`).join("")}</select></label>
        <label class="field" style="flex:1;min-width:120px">Duración (min)
          <input id="mins" type="number" min="15" max="180" value="${active?.minutes_per_session || 45}"></label>
        <button class="btn primary" id="gen" style="align-self:flex-end">${ICON.spark}Generar</button>
      </div>
    </div>
    <div class="grid cols-2" id="list"></div>`;

  const listEl = el.querySelector("#list");
  if (!routines.length) {
    listEl.innerHTML = `<div class="card span-2">${emptyState("Todavía no tienes rutinas",
      "Genera una propuesta arriba o crea una desde cero.", `<a class="btn primary" href="#/rutinas/nueva">Crear rutina</a>`)}</div>`;
  } else {
    listEl.innerHTML = routines.map((rt) => {
      const regions = Object.entries(rt.estimate.regions).filter(([k]) => k !== "cardio").sort((a, b) => b[1] - a[1]).slice(0, 5);
      const days = usedBy.get(rt.id);
      return `<div class="card">
        <div class="card-head"><div><h2>${esc(rt.name)}</h2>
          <div class="sub">${rt.items.length} ejercicios · ~${fmt.int(rt.estimate.minutes)} min · ~${fmt.int(rt.estimate.kcal)} kcal</div></div>
          ${days ? `<span class="chip accent" title="Días asignados en el plan activo">${esc(days.join(", "))}</span>` : ""}</div>
        ${rt.description ? `<p class="small muted" style="margin-bottom:10px">${esc(rt.description)}</p>` : ""}
        <div class="chips" style="margin-bottom:12px">${regions.map(([k]) => `<span class="chip">${esc(regionLabel(k))}</span>`).join("")}</div>
        <div class="row">
          <a class="btn primary sm" href="#/entrenar?routine=${rt.id}">${ICON.play}Entrenar</a>
          <a class="btn sm" href="#/rutinas/editar/${rt.id}">${ICON.edit}Editar</a>
          <button class="btn sm" data-dup="${rt.id}">${ICON.copy}Duplicar</button>
          <span class="spacer"></span>
          <button class="btn sm ghost danger" data-del="${rt.id}" aria-label="Eliminar">${ICON.trash}</button>
        </div></div>`;
    }).join("");
  }

  el.querySelector("#gen").addEventListener("click", async () => {
    try {
      const sug = await api.post("/api/routines/suggest", {
        template: el.querySelector("#tpl").value,
        minutes: Number(el.querySelector("#mins").value) || 45,
        seed: Math.floor(Math.random() * 1e9),
      });
      pendingDraft = { name: sug.name, description: "Rutina generada automáticamente.", items: sug.items, notes: sug.notes };
      navigate("#/rutinas/nueva?borrador=1");
    } catch (err) { toast(err.message, "error"); }
  });

  listEl.addEventListener("click", async (e) => {
    const dup = e.target.closest("[data-dup]");
    const del = e.target.closest("[data-del]");
    try {
      if (dup) {
        const rt = routines.find((x) => x.id === Number(dup.dataset.dup));
        await api.post("/api/routines", { name: `${rt.name} (copia)`.slice(0, 80), description: rt.description, items: rt.items.map(cleanItem) });
        toast("Rutina duplicada");
        list(el);
      } else if (del) {
        const rt = routines.find((x) => x.id === Number(del.dataset.del));
        const ok = await confirmDialog(`¿Eliminar la rutina «${rt.name}»? Las sesiones ya registradas se conservan.`, { ok: "Eliminar", danger: true });
        if (!ok) return;
        await api.del(`/api/routines/${rt.id}`);
        toast("Rutina eliminada");
        list(el);
      }
    } catch (err) { toast(err.message, "error"); }
  });
}

// ----------------------------------------------------------------- editor
async function editor(el, id, query) {
  let state;
  let notes = [];
  if (id) {
    const all = await api.get("/api/routines");
    const rt = all.find((x) => x.id === id);
    if (!rt) { el.innerHTML = emptyState("Rutina no encontrada", "Puede que se haya eliminado.", `<a class="btn" href="#/rutinas">Volver</a>`); return; }
    state = { name: rt.name, description: rt.description, items: rt.items.map(cleanItem) };
  } else if (query.borrador && pendingDraft) {
    state = { name: pendingDraft.name, description: pendingDraft.description, items: pendingDraft.items.map(cleanItem) };
    notes = pendingDraft.notes || [];
    pendingDraft = null;
  } else {
    state = { name: "", description: "", items: [] };
  }
  if (query.add && store.byId.has(query.add)) {
    const ex = store.byId.get(query.add);
    state.items.push(cleanItem({ ...ex.default, exercise_id: ex.id }));
  }
  guard.dirty = !id && state.items.length > 0;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>${id ? "Editar rutina" : "Nueva rutina"}</h1><p>Ajusta series, repeticiones o tiempo, descanso y carga de cada ejercicio.</p></div>
      <div class="row"><a class="btn" href="#/rutinas">Cancelar</a><button class="btn primary" id="save">${ICON.check}Guardar rutina</button></div>
    </div>
    ${notes.length ? `<div class="callout accent" style="margin-bottom:16px">${notes.map((n) => `<div>• ${esc(n)}</div>`).join("")}</div>` : ""}
    <div class="editor">
      <div class="stack">
        <div class="card">
          <div class="form-grid name-desc">
            <label class="field">Nombre<input id="name" maxlength="80" value="${esc(state.name)}" placeholder="p. ej. Cuerpo completo A"></label>
            <label class="field">Descripción <span class="hint">(opcional)</span><input id="desc" maxlength="1000" value="${esc(state.description)}"></label>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Ejercicios</h2><button class="btn" id="addEx">${ICON.plus}Añadir ejercicio</button></div>
          <div class="item-row item-head"><span></span><span></span><span style="text-align:left">Ejercicio</span>
            <span>Series</span><span>Reps</span><span>Tiempo (s)</span><span>Desc. (s)</span><span>Kg</span><span></span></div>
          <div id="items"></div>
          <p class="small muted" style="margin-top:10px">Usa <b>Reps</b> para ejercicios de fuerza o <b>Tiempo</b> para cardio, planchas y estiramientos (deja el otro en 0).</p>
        </div>
      </div>
      <div class="editor-side stack">
        <div class="card">
          <h2 style="margin-bottom:12px">Resumen estimado</h2>
          <div class="kv">
            <div><div class="k">Duración</div><div class="v" id="sumMin">–</div></div>
            <div><div class="k">Calorías</div><div class="v" id="sumKcal">–</div></div>
          </div>
          <p class="small muted" style="margin-top:8px" id="sumNote">Para tu peso actual (${fmt.kg(store.profile.current_weight)}).</p>
        </div>
        <div class="card"><h2 style="margin-bottom:10px">Músculos trabajados</h2><div id="map"></div>
          <div id="regionBars" style="margin-top:12px"></div></div>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const itemsEl = $("#items");

  const drawItems = () => {
    if (!state.items.length) {
      itemsEl.innerHTML = emptyState("Sin ejercicios", "Añade ejercicios desde la biblioteca.");
      return;
    }
    itemsEl.innerHTML = state.items.map((it, i) => {
      const ex = store.byId.get(it.exercise_id);
      const num = (f, label, step = 1, max = 9999) => `<label><span class="cell-label">${label}</span>
        <input type="number" inputmode="decimal" min="0" max="${max}" step="${step}" data-i="${i}" data-f="${f}" value="${it[f]}" aria-label="${label}"></label>`;
      return `<div class="item-row">
        <span class="idx">${i + 1}</span>
        <img class="mini-thumb" src="${ex.image}" alt="">
        <div class="item-title"><div class="ex-name" data-detail="${ex.id}" title="Ver ficha">${esc(ex.name)}</div>
          <div class="sub">${esc(ex.target_es)} · ${esc(ex.equipment_es)}${it.duration_sec ? " · " + fmt.dur(it.duration_sec) : ""}${ex.impact !== "bajo" ? ` · <span class="status warning">impacto ${ex.impact}</span>` : ""}</div></div>
        <div class="cells">
          ${num("sets", "Series", 1, 50)}${num("reps", "Reps", 1, 500)}${num("duration_sec", "Tiempo (s)", 5, 14400)}
          ${num("rest_sec", "Desc. (s)", 5, 900)}${num("weight_kg", "Kg", 0.5, 1000)}
        </div>
        <div class="item-actions">
          <button class="btn ghost icon" data-up="${i}" aria-label="Subir" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button class="btn ghost icon" data-down="${i}" aria-label="Bajar" ${i === state.items.length - 1 ? "disabled" : ""}>${ICON.down}</button>
          <button class="btn ghost icon danger" data-rm="${i}" aria-label="Quitar">${ICON.trash}</button>
        </div></div>`;
    }).join("");
  };

  const estimate = debounce(async () => {
    if (!state.items.length) {
      $("#sumMin").textContent = "–"; $("#sumKcal").textContent = "–";
      renderBodyMap($("#map"), {}); $("#regionBars").innerHTML = "";
      return;
    }
    try {
      const est = await api.post("/api/estimate", { items: state.items });
      $("#sumMin").textContent = `${fmt.int(est.minutes)} min`;
      $("#sumKcal").textContent = `${fmt.int(est.kcal)} kcal`;
      $("#sumNote").textContent = `Para tu peso actual (${fmt.kg(store.profile.current_weight)}), incluye descansos y ~1 min de transición entre ejercicios.`;
      renderBodyMap($("#map"), est.regions);
      const bars = Object.entries(est.regions).filter(([k]) => k !== "cardio").sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => ({ label: regionLabel(k), value: v, display: fmt.dec(v) }));
      $("#regionBars").innerHTML = hbars(bars, { unit: "series" });
    } catch (err) {
      $("#sumNote").textContent = err.message;
    }
  }, 300);

  const changed = () => { guard.dirty = true; estimate(); };

  itemsEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.f == null) return;
    const v = t.value === "" ? 0 : Number(t.value);
    state.items[Number(t.dataset.i)][t.dataset.f] = isNaN(v) ? 0 : v;
    changed();
  });
  itemsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    const det = e.target.closest("[data-detail]");
    if (det) return openExerciseDetail(det.dataset.detail);
    if (!b) return;
    const swap = (a, c) => { [state.items[a], state.items[c]] = [state.items[c], state.items[a]]; };
    if (b.dataset.up) swap(Number(b.dataset.up), Number(b.dataset.up) - 1);
    else if (b.dataset.down) swap(Number(b.dataset.down), Number(b.dataset.down) + 1);
    else if (b.dataset.rm) state.items.splice(Number(b.dataset.rm), 1);
    else return;
    drawItems(); changed();
  });
  $("#name").addEventListener("input", (e) => { state.name = e.target.value; guard.dirty = true; });
  $("#desc").addEventListener("input", (e) => { state.description = e.target.value; guard.dirty = true; });
  $("#addEx").addEventListener("click", () => openPicker({
    onPick: (ex) => { state.items.push(cleanItem({ ...ex.default, exercise_id: ex.id })); drawItems(); changed(); },
  }));
  $("#save").addEventListener("click", async () => {
    if (!state.name.trim()) { toast("Ponle un nombre a la rutina.", "error"); $("#name").focus(); return; }
    if (!state.items.length) { toast("Añade al menos un ejercicio.", "error"); return; }
    try {
      const body = { name: state.name.trim(), description: state.description.trim(), items: state.items };
      if (id) await api.put(`/api/routines/${id}`, body);
      else await api.post("/api/routines", body);
      guard.dirty = false;
      toast("Rutina guardada");
      navigate("#/rutinas");
    } catch (err) { toast(err.message, "error"); }
  });

  drawItems();
  estimate();
}
