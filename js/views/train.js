import { api, store, refreshProfile } from "../api.js";
import { esc, fmt, toast, todayISO, debounce, emptyState, ICON } from "../util.js";
import { openPicker, openExerciseDetail } from "../components.js";
import { guard, navigate } from "../app.js";

const pick = (it) => ({
  exercise_id: it.exercise_id,
  sets: Number(it.sets) || 0,
  reps: Number(it.reps) || 0,
  duration_sec: Number(it.duration_sec) || 0,
  rest_sec: Number(it.rest_sec) || 0,
  weight_kg: Number(it.weight_kg) || 0,
});

export async function render(el, r) {
  const q = r.query;
  const [routines, plans] = await Promise.all([api.get("/api/routines"), api.get("/api/plans")]);
  const active = plans.find((p) => p.active);
  const todayWd = (new Date().getDay() + 6) % 7;
  const scheduledId = active?.schedule?.[String(todayWd)] || null;

  let editingId = null;
  const state = { date: todayISO(), routine_id: null, name: "", entries: [], duration_min: "", rpe: 6, notes: "", body_weight: "" };

  const loadRoutine = (rid) => {
    const rt = routines.find((x) => x.id === Number(rid));
    state.routine_id = rt ? rt.id : null;
    state.name = rt ? rt.name : "Sesión libre";
    state.entries = rt ? rt.items.map((it) => ({ ...pick(it), done: true })) : [];
  };

  if (q.session && q.date) {
    const sessions = await api.get(`/api/sessions?from=${q.date}&to=${q.date}`);
    const s = sessions.find((x) => x.id === Number(q.session));
    if (s) {
      editingId = s.id;
      Object.assign(state, { date: s.date, routine_id: s.routine_id, name: s.name, duration_min: s.duration_min,
        rpe: s.rpe || 6, notes: s.notes, body_weight: s.body_weight || "",
        entries: s.entries.map((e) => ({ ...pick(e), done: true })) });
    }
  }
  if (!editingId) loadRoutine(q.routine || scheduledId || "");

  const cardio = store.exercises.filter((e) => e.kind === "cardio").sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `
    <div class="page-head">
      <div><h1>${editingId ? "Editar sesión" : "Registrar entrenamiento"}</h1>
        <p>Marca lo que realmente hiciste y ajusta series, repeticiones o carga. El gasto se calcula con tu peso.</p></div>
    </div>
    <div class="editor">
      <div class="stack">
        <div class="card">
          <div class="form-grid">
            <label class="field">Rutina
              <select id="routine" ${editingId ? "disabled" : ""}>
                <option value="">Sesión libre</option>
                ${routines.map((rt) => `<option value="${rt.id}">${esc(rt.name)}${rt.id === scheduledId ? " (hoy)" : ""}</option>`).join("")}
              </select></label>
            <label class="field">Fecha<input id="date" type="date" max="${todayISO()}" value="${state.date}"></label>
            <label class="field">Nombre de la sesión<input id="sname" maxlength="80" value="${esc(state.name)}"></label>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Ejercicios realizados</h2><button class="btn" id="addEx">${ICON.plus}Añadir ejercicio</button></div>
          <div class="item-row item-head"><span>Hecho</span><span></span><span style="text-align:left">Ejercicio</span>
            <span>Series</span><span>Reps</span><span>Tiempo (s)</span><span>Desc. (s)</span><span>Kg</span><span></span></div>
          <div id="items"></div>
        </div>
        <div class="card">
          <h2 style="margin-bottom:12px">Cómo fue</h2>
          <div class="form-grid">
            <label class="field">Duración real (min) <span class="hint">Opcional: ajusta el gasto</span>
              <input id="dur" type="number" min="1" max="600" value="${state.duration_min}"></label>
            <label class="field">Esfuerzo percibido (RPE): <b id="rpeV">${state.rpe}</b>/10
              <input id="rpe" type="range" min="1" max="10" value="${state.rpe}"></label>
            <label class="field">Peso corporal hoy (kg) <span class="hint">Opcional</span>
              <input id="bw" type="number" step="0.1" min="30" max="350" value="${state.body_weight}"></label>
          </div>
          <label class="check" style="margin-top:10px"><input type="checkbox" id="saveWeight" checked> Guardar también el peso en mi registro</label>
          <label class="field" style="margin-top:12px">Notas<textarea id="notes" maxlength="2000" placeholder="Sensaciones, molestias, cargas a subir la próxima vez…">${esc(state.notes)}</textarea></label>
        </div>
      </div>
      <div class="editor-side stack">
        <div class="card">
          <h2 style="margin-bottom:12px">Resumen</h2>
          <div class="kv">
            <div><div class="k">Duración</div><div class="v" id="sMin">–</div></div>
            <div><div class="k">Calorías</div><div class="v" id="sKcal">–</div></div>
            <div><div class="k">Ejercicios</div><div class="v" id="sCount">–</div></div>
            <div><div class="k">Series</div><div class="v" id="sSets">–</div></div>
          </div>
          <p class="small muted" style="margin-top:8px" id="sNote"></p>
          <button class="btn primary" id="save" style="width:100%;justify-content:center;margin-top:14px">${ICON.check}${editingId ? "Guardar cambios" : "Guardar sesión"}</button>
        </div>
        ${editingId ? "" : `
        <div class="card">
          <h2>Actividad rápida</h2>
          <p class="small muted" style="margin:4px 0 12px">Para registrar cardio suelto: caminata, bici, elíptica…</p>
          <div class="stack" style="gap:10px">
            <label class="field">Actividad<select id="qaEx">${cardio.map((e) => `<option value="${e.id}" ${e.id === "3666" ? "selected" : ""}>${esc(e.name)} (MET ${fmt.dec(e.met)})</option>`).join("")}</select></label>
            <div class="row">
              <label class="field" style="flex:1">Minutos<input id="qaMin" type="number" min="1" max="600" value="30"></label>
              <label class="field" style="flex:1">Fecha<input id="qaDate" type="date" max="${todayISO()}" value="${todayISO()}"></label>
            </div>
            <button class="btn" id="qaSave">${ICON.plus}Registrar actividad</button>
          </div>
        </div>`}
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const itemsEl = $("#items");

  const drawItems = () => {
    if (!state.entries.length) {
      itemsEl.innerHTML = emptyState("Sin ejercicios", "Elige una rutina o añade ejercicios manualmente.");
      return;
    }
    itemsEl.innerHTML = state.entries.map((it, i) => {
      const ex = store.byId.get(it.exercise_id);
      const num = (f, label, step = 1) => `<label><span class="cell-label">${label}</span>
        <input type="number" min="0" step="${step}" data-i="${i}" data-f="${f}" value="${it[f]}" aria-label="${label}" ${it.done ? "" : "disabled"}></label>`;
      return `<div class="item-row ${it.done ? "" : "done-off"}">
        <input type="checkbox" data-done="${i}" ${it.done ? "checked" : ""} aria-label="Hecho" style="justify-self:center">
        <img class="mini-thumb" src="${ex.image}" alt="">
        <div class="item-title"><div class="ex-name" data-detail="${ex.id}">${esc(ex.name)}</div>
          <div class="sub">${esc(ex.target_es)}${it.duration_sec ? " · " + fmt.dur(it.duration_sec) : ""}</div></div>
        <div class="cells">${num("sets", "Series")}${num("reps", "Reps")}${num("duration_sec", "Tiempo (s)", 5)}${num("rest_sec", "Desc. (s)", 5)}${num("weight_kg", "Kg", 0.5)}</div>
        <div class="item-actions"><button class="btn ghost icon danger" data-rm="${i}" aria-label="Quitar">${ICON.trash}</button></div>
      </div>`;
    }).join("");
  };

  const doneEntries = () => state.entries.filter((e) => e.done && e.sets > 0).map(pick);

  const estimate = debounce(async () => {
    const entries = doneEntries();
    $("#sCount").textContent = entries.length;
    $("#sSets").textContent = entries.reduce((a, e) => a + e.sets, 0);
    if (!entries.length) { $("#sMin").textContent = "–"; $("#sKcal").textContent = "–"; $("#sNote").textContent = ""; return; }
    try {
      const bw = Number(state.body_weight) || undefined;
      const est = await api.post("/api/estimate", { items: entries, body_weight: bw });
      const dur = Number(state.duration_min);
      const factor = dur > 0 && est.minutes > 0 ? Math.max(0.5, Math.min(1.5, dur / est.minutes)) : 1;
      $("#sMin").textContent = `${fmt.int(dur || est.minutes)} min`;
      $("#sKcal").textContent = `${fmt.int(est.kcal * factor)} kcal`;
      $("#sNote").textContent = dur ? `Gasto ajustado a la duración real (estimada: ${fmt.int(est.minutes)} min).`
        : "Estimación según series, tiempo y descansos.";
    } catch (err) { $("#sNote").textContent = err.message; }
  }, 250);

  const changed = () => { guard.dirty = true; estimate(); };

  $("#routine").value = state.routine_id || "";
  $("#routine").addEventListener("change", (e) => { loadRoutine(e.target.value); $("#sname").value = state.name; drawItems(); changed(); });
  $("#date").addEventListener("change", (e) => { state.date = e.target.value; guard.dirty = true; });
  $("#sname").addEventListener("input", (e) => { state.name = e.target.value; guard.dirty = true; });
  $("#dur").addEventListener("input", (e) => { state.duration_min = e.target.value; changed(); });
  $("#rpe").addEventListener("input", (e) => { state.rpe = Number(e.target.value); $("#rpeV").textContent = state.rpe; guard.dirty = true; });
  $("#bw").addEventListener("input", (e) => { state.body_weight = e.target.value; changed(); });
  $("#notes").addEventListener("input", (e) => { state.notes = e.target.value; guard.dirty = true; });

  itemsEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.done != null) { state.entries[Number(t.dataset.done)].done = t.checked; drawItems(); changed(); return; }
    if (t.dataset.f == null) return;
    const v = Number(t.value);
    state.entries[Number(t.dataset.i)][t.dataset.f] = isNaN(v) ? 0 : v;
    changed();
  });
  itemsEl.addEventListener("click", (e) => {
    const det = e.target.closest("[data-detail]");
    if (det) return openExerciseDetail(det.dataset.detail);
    const rm = e.target.closest("[data-rm]");
    if (rm) { state.entries.splice(Number(rm.dataset.rm), 1); drawItems(); changed(); }
  });
  $("#addEx").addEventListener("click", () => openPicker({
    onPick: (ex) => { state.entries.push({ ...ex.default, exercise_id: ex.id, weight_kg: 0, done: true }); drawItems(); changed(); },
  }));

  $("#save").addEventListener("click", async () => {
    const entries = doneEntries();
    if (!entries.length) { toast("Marca al menos un ejercicio como hecho.", "error"); return; }
    if (!state.date || state.date > todayISO()) { toast("La fecha no puede ser futura.", "error"); return; }
    const body = {
      date: state.date, routine_id: state.routine_id, name: state.name.trim() || "Entrenamiento", entries,
      duration_min: Number(state.duration_min) || null, rpe: state.rpe, notes: state.notes,
      body_weight: Number(state.body_weight) || null,
    };
    try {
      const saved = editingId ? await api.put(`/api/sessions/${editingId}`, body) : await api.post("/api/sessions", body);
      if (body.body_weight && $("#saveWeight").checked) {
        await api.post("/api/weights", { date: state.date, weight_kg: body.body_weight, note: "Registrado en sesión" });
        await refreshProfile();
      }
      guard.dirty = false;
      toast(`Sesión guardada: ${fmt.int(saved.kcal)} kcal en ${fmt.int(saved.duration_min)} min`);
      navigate(`#/semana?start=${state.date}`);
    } catch (err) { toast(err.message, "error"); }
  });

  $("#qaSave")?.addEventListener("click", async () => {
    const exId = $("#qaEx").value, mins = Number($("#qaMin").value);
    if (!(mins >= 1 && mins <= 600)) { toast("Indica entre 1 y 600 minutos.", "error"); return; }
    const ex = store.byId.get(exId);
    try {
      const saved = await api.post("/api/sessions", {
        date: $("#qaDate").value, name: ex.pattern || ex.name, routine_id: null,
        entries: [{ exercise_id: exId, sets: 1, reps: 0, duration_sec: Math.round(mins * 60), rest_sec: 0, weight_kg: 0 }],
      });
      toast(`Actividad registrada: ${fmt.int(saved.kcal)} kcal`);
    } catch (err) { toast(err.message, "error"); }
  });

  drawItems();
  estimate();
}
