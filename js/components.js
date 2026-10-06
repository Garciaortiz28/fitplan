// Componentes compartidos entre vistas.
import { api, store, regionLabel } from "./api.js";
import { esc, fmt, cap, openModal, toast, ICON } from "./util.js";
import { renderBodyMap } from "./bodymap.js";

export const KIND_LABEL = { fuerza: "Fuerza", cardio: "Cardio", flexibilidad: "Movilidad" };
export const IMPACT_LABEL = { bajo: "Impacto bajo", medio: "Impacto medio", alto: "Impacto alto" };
export const LEVEL_LABEL = { principiante: "Principiante", intermedio: "Intermedio", avanzado: "Avanzado" };

export const normalize = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Filtra el catálogo. f: {q, body_part, equipment, region, kind, impact, level, myEquipment, sort} */
export function filterExercises(list, f) {
  const terms = normalize(f.q).split(/\s+/).filter(Boolean);
  const myEq = f.myEquipment && store.profile?.equipment?.length ? new Set(store.profile.equipment) : null;
  const lvl = { principiante: 0, intermedio: 1, avanzado: 2 };
  const out = list.filter((e) => {
    if (f.body_part && e.body_part !== f.body_part) return false;
    if (f.equipment && e.equipment !== f.equipment) return false;
    if (f.kind && e.kind !== f.kind) return false;
    if (f.impact && e.impact !== f.impact) return false;
    if (f.level && lvl[e.difficulty] > lvl[f.level]) return false;
    if (f.region && e.primary_region !== f.region && !e.secondary_regions.includes(f.region)) return false;
    if (myEq && !myEq.has(e.equipment)) return false;
    if (terms.length) {
      const hay = e._search || (e._search = normalize(e.search));
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const sorters = {
    // Relevancia: primero los ejercicios estándar (nombres simples, sin variantes) con buen estímulo.
    relevancia: (a, b) => simplicity(a) - simplicity(b) || a.name.localeCompare(b.name),
    kcal: (a, b) => b.met - a.met || b.calorie_score - a.calorie_score,
    musculo: (a, b) => b.muscle_score - a.muscle_score || b.met - a.met,
    nombre: (a, b) => a.name.localeCompare(b.name),
    region: (a, b) => (f.region ? Number(b.primary_region === f.region) - Number(a.primary_region === f.region) : 0) || b.muscle_score - a.muscle_score,
  };
  out.sort(f.region && (!f.sort || f.sort === "relevancia") ? sorters.region : sorters[f.sort] || sorters.relevancia);
  return out;
}

const ODD = ["one arm", "one leg", "single", "exercise ball", "stability ball", "bosu", "with ", "(", "v. ", "stork", "pov", "male", "female", "twist"];
const LEVEL_PENALTY = { principiante: 0, intermedio: 1.5, avanzado: 4 };
function simplicity(e) {
  if (e._simp == null) {
    // Básicos de referencia primero; luego nombres simples, sin variantes y de menor dificultad.
    const staple = e.staple_rank == null ? 0 : -10 + e.staple_rank * 0.3;
    e._simp = staple + ODD.reduce((a, k) => a + (e.name.includes(k) ? 2 : 0), 0) + e.name.split(" ").length * 0.5
      + LEVEL_PENALTY[e.difficulty] + (e.impact === "alto" ? 1.5 : 0) - e.muscle_score * 0.3;
  }
  return e._simp;
}

export function scoreBars(e) {
  return `
    <div class="score" title="Índice de quema calórica (1-10), basado en el MET del ejercicio">
      <span>Calorías</span><div class="bar kcal"><span style="width:${e.calorie_score * 10}%"></span></div><b>${e.calorie_score}</b></div>
    <div class="score" title="Índice de estímulo para construir músculo (1-10)">
      <span>Músculo</span><div class="bar musc"><span style="width:${e.muscle_score * 10}%"></span></div><b>${e.muscle_score}</b></div>`;
}

export function impactBadge(e) {
  return e.impact === "bajo" ? "" : `<span class="impact-badge ${e.impact} badge">${IMPACT_LABEL[e.impact]}</span>`;
}

export function exerciseCard(e) {
  return `
    <article class="ex-card" data-ex="${e.id}" tabindex="0" aria-label="${esc(e.name)}">
      <div class="thumb"><img src="${e.image}" alt="" loading="lazy" decoding="async" width="180" height="180">${impactBadge(e)}</div>
      <div class="body">
        <div><div class="ex-name">${esc(e.name)}</div>
          <div class="ex-pattern">${esc(e.pattern || KIND_LABEL[e.kind])} · ${esc(e.target_es)}</div></div>
        <div class="chips"><span class="chip">${esc(e.body_part_es)}</span><span class="chip">${esc(e.equipment_es)}</span></div>
        <div style="margin-top:auto">${scoreBars(e)}</div>
      </div>
    </article>`;
}

export function prescriptionText(it) {
  if (!it) return "";
  const work = it.duration_sec > 0 ? fmt.dur(it.duration_sec) : `${it.reps} reps`;
  const rest = it.rest_sec ? ` · descanso ${it.rest_sec}s` : "";
  return `${it.sets} × ${work}${rest}`;
}

/** Ficha completa de un ejercicio con opción de añadirlo a una rutina. */
export async function openExerciseDetail(id) {
  let ex, routines;
  try {
    [ex, routines] = await Promise.all([api.get(`/api/exercises/${id}`), api.get("/api/routines")]);
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  const highImpactWarn = ex.impact !== "bajo" && (store.profile?.metrics?.bmi || 0) >= 30
    ? `<div class="callout" style="margin-top:12px"><span class="status warning">Precaución articular</span><br>
       Con tu IMC actual, introduce este ejercicio de forma progresiva o sustitúyelo por una alternativa de bajo impacto.</div>` : "";
  const html = `
    <div class="detail">
      <div>
        <img class="gif" src="${ex.gif}" alt="Animación de ${esc(ex.name)}">
        <p class="attribution" style="margin-top:6px">${esc(ex.attribution)}</p>
        <div id="dmap" style="margin-top:14px"></div>
      </div>
      <div class="stack" style="gap:14px">
        <div>
          <div class="chips" style="margin-bottom:8px">
            <span class="chip accent">${esc(KIND_LABEL[ex.kind])}</span>
            <span class="chip">${esc(ex.body_part_es)}</span><span class="chip">${esc(ex.equipment_es)}</span>
            <span class="chip">${esc(LEVEL_LABEL[ex.difficulty])}</span><span class="chip">${esc(IMPACT_LABEL[ex.impact])}</span>
            ${ex.compound ? `<span class="chip">Multiarticular</span>` : ""}
          </div>
          <p class="ink-2">${esc(ex.pattern || "")}</p>
        </div>
        <div class="kv">
          <div><div class="k">Gasto en 10 min</div><div class="v">${fmt.int(ex.kcal_10min)} kcal</div></div>
          <div><div class="k">Intensidad (MET)</div><div class="v">${fmt.dec(ex.met)}</div></div>
          <div><div class="k">Quema calórica</div><div class="v">${ex.calorie_score}/10</div></div>
          <div><div class="k">Estímulo muscular</div><div class="v">${ex.muscle_score}/10</div></div>
        </div>
        <p class="small muted">Gasto calculado para tu peso actual (${fmt.kg(ex.weight_ref)}) con la fórmula MET × 3,5 × peso / 200.</p>
        <div>
          <h3 style="margin-bottom:6px">Músculos implicados</h3>
          <p><b>Principal:</b> ${esc(ex.target_es)}${regionLabel(ex.primary_region) !== ex.target_es
            ? ` <span class="muted">(${esc(regionLabel(ex.primary_region))})</span>` : ""}</p>
          <p><b>Secundarios:</b> ${ex.secondary_es.length ? esc(ex.secondary_es.join(", ")) : "—"}</p>
        </div>
        <div>
          <h3 style="margin-bottom:6px">Prescripción recomendada</h3>
          <p>${esc(prescriptionText(ex.default))}</p>
        </div>
        <div>
          <div class="row between" style="margin-bottom:6px"><h3>Cómo se hace</h3>
            <div class="seg" id="langSeg"><button class="on" data-l="es">ES</button><button data-l="en">EN</button></div></div>
          <ol class="steps" id="steps">${ex.steps_es.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        </div>
        ${highImpactWarn}
        <div class="callout">
          <b>Añadir a una rutina</b>
          <div class="row" style="margin-top:8px">
            <select id="addRoutine" style="flex:1;min-width:160px">
              ${routines.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}
              <option value="new">+ Nueva rutina…</option>
            </select>
            <button class="btn primary" id="addBtn">${ICON.plus}Añadir</button>
          </div>
        </div>
      </div>
    </div>`;
  const m = openModal({ title: cap(ex.name), html, wide: true });
  renderBodyMap(m.el.querySelector("#dmap"), { primary: ex.primary_region, secondary: ex.secondary_regions }, { mode: "exercise" });
  m.el.querySelectorAll("#langSeg button").forEach((b) => b.addEventListener("click", () => {
    m.el.querySelectorAll("#langSeg button").forEach((x) => x.classList.toggle("on", x === b));
    const steps = b.dataset.l === "es" ? ex.steps_es : ex.steps_en;
    m.el.querySelector("#steps").innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join("");
  }));
  m.el.querySelector("#addBtn").addEventListener("click", async () => {
    const sel = m.el.querySelector("#addRoutine").value;
    if (sel === "new") {
      m.close();
      location.hash = `#/rutinas/nueva?add=${ex.id}`;
      return;
    }
    const r = routines.find((x) => String(x.id) === sel);
    try {
      const items = r.items.map(({ exercise_id, sets, reps, duration_sec, rest_sec, weight_kg, notes }) =>
        ({ exercise_id, sets, reps, duration_sec, rest_sec, weight_kg, notes }));
      items.push({ ...ex.default, exercise_id: ex.id, weight_kg: 0, notes: "" });
      await api.put(`/api/routines/${r.id}`, { name: r.name, description: r.description, items });
      r.items = items;
      toast(`Añadido a «${r.name}»`);
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/** Selector de ejercicios en modal. onPick(ex) se llama por cada ejercicio elegido. */
export function openPicker({ title = "Añadir ejercicio", onPick, preset = {} }) {
  const meta = store.meta;
  const html = `
    <div class="filters" style="grid-template-columns:2fr 1fr 1fr 1fr">
      <input class="search" id="pq" type="search" placeholder="Buscar: sentadilla, pecho, remo, mancuernas…" autocomplete="off">
      <select id="pbp"><option value="">Todas las zonas</option>${meta.body_parts.map((b) => `<option value="${b.key}">${esc(b.label)}</option>`).join("")}</select>
      <select id="peq"><option value="">Todo el equipo</option>${meta.equipment.map((b) => `<option value="${b.key}">${esc(b.label)}</option>`).join("")}</select>
      <select id="pkind"><option value="">Todos los tipos</option><option value="fuerza">Fuerza</option><option value="cardio">Cardio</option><option value="flexibilidad">Movilidad</option></select>
    </div>
    <label class="check small" style="margin-bottom:10px"><input type="checkbox" id="pmy"> Solo con mi equipamiento</label>
    <div class="picker-list" id="plist"></div>
    <p class="small muted" id="pcount" style="margin-top:8px"></p>`;
  const m = openModal({ title, html, wide: true, footer: `<button class="btn primary" data-done>Listo</button>` });
  const $m = (s) => m.el.querySelector(s);
  if (preset.kind) $m("#pkind").value = preset.kind;
  $m("#pmy").checked = !!store.profile?.equipment?.length;
  const draw = () => {
    const list = filterExercises(store.exercises, {
      q: $m("#pq").value, body_part: $m("#pbp").value, equipment: $m("#peq").value,
      kind: $m("#pkind").value, myEquipment: $m("#pmy").checked, sort: "relevancia",
    });
    const shown = list.slice(0, 120);
    $m("#plist").innerHTML = shown.map((e) => `
      <div class="picker-item" data-ex="${e.id}">
        <img class="mini-thumb" src="${e.image}" alt="" loading="lazy">
        <div style="flex:1;min-width:0"><div class="ex-name">${esc(e.name)}</div>
          <div class="small muted">${esc(e.pattern || KIND_LABEL[e.kind])} · ${esc(e.target_es)} · ${esc(e.equipment_es)}</div></div>
        <span class="chip" title="Calorías / Músculo">🔥${e.calorie_score} · 💪${e.muscle_score}</span>
        <button class="btn sm primary" data-add="${e.id}">${ICON.plus}Añadir</button>
      </div>`).join("") || `<div class="empty">No hay ejercicios con esos filtros.</div>`;
    $m("#pcount").textContent = list.length > shown.length
      ? `Mostrando ${shown.length} de ${list.length}. Afina la búsqueda para ver más.`
      : `${list.length} ejercicios`;
  };
  ["#pq", "#pbp", "#peq", "#pkind", "#pmy"].forEach((s) => $m(s).addEventListener("input", draw));
  $m("#plist").addEventListener("click", (ev) => {
    const add = ev.target.closest("[data-add]");
    if (add) {
      const ex = store.byId.get(add.dataset.add);
      onPick(ex);
      toast(`Añadido: ${ex.name}`);
      return;
    }
    const item = ev.target.closest("[data-ex]");
    if (item) openExerciseDetail(item.dataset.ex);
  });
  m.el.querySelector("[data-done]").addEventListener("click", m.close);
  draw();
  setTimeout(() => $m("#pq").focus(), 50);
  return m;
}

/** Tarjeta de indicador con medidor opcional frente a un objetivo. */
export function statTile({ label, value, unit = "", foot = "", target = null, current = null, meterClass = "" }) {
  const pct = target ? Math.min(100, ((current ?? 0) / target) * 100) : null;
  return `<div class="card tile">
    <div class="label">${esc(label)}</div>
    <div class="value">${value}${unit ? `<small>${esc(unit)}</small>` : ""}</div>
    ${pct != null ? `<div class="meter ${meterClass}" role="meter" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ""}
    ${foot ? `<div class="foot">${foot}</div>` : ""}
  </div>`;
}
