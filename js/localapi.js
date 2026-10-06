// API local de FitPlan para el móvil: reproduce los endpoints de app/server.py
// (mismas rutas, mismas respuestas y mismas validaciones) sobre IndexedDB.
import * as E from "./engine.js";
import { S, save, loadAll, nextId, DEFAULT_PROFILE, requestPersistence } from "./storage.js";

let CATALOG = null;
let readyP = null;

export function ready() {
  if (!readyP) {
    readyP = (async () => {
      const [cat, consts] = await Promise.all([
        fetch("data/catalog.json").then((r) => { if (!r.ok) throw new Error("No se pudo cargar el catálogo."); return r.json(); }),
        fetch("data/engine.json").then((r) => { if (!r.ok) throw new Error("No se pudo cargar el motor."); return r.json(); }),
      ]);
      CATALOG = cat;
      E.initEngine(consts, cat.exercises);
      await loadAll();
      requestPersistence();
    })();
    readyP.catch(() => { readyP = null; });
  }
  return readyP;
}

class ApiError extends Error {}
const fail = (m) => { throw new ApiError(m); };

// ----------------------------------------------------------- validación
function num(d, key, lo, hi, { required = false, integer = false, def = null } = {}) {
  let v = d?.[key];
  if (v === undefined || v === null || v === "") {
    if (required) fail(`El campo «${key}» es obligatorio.`);
    return def;
  }
  v = Number(v);
  if (!Number.isFinite(v)) fail(`El campo «${key}» debe ser numérico.`);
  if (integer) v = Math.trunc(v);
  if (v < lo || v > hi) fail(`El campo «${key}» debe estar entre ${lo} y ${hi}.`);
  return v;
}
function text(d, key, max = 200, { required = false } = {}) {
  const v = d?.[key] == null ? "" : String(d[key]).trim();
  if (required && !v) fail(`El campo «${key}» es obligatorio.`);
  return v.slice(0, max);
}
function isoDate(d, key, { required = true, def = null } = {}) {
  const v = d?.[key] || def;
  if (!v) { if (required) fail(`El campo «${key}» es obligatorio.`); return null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  const dt = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) fail(`Fecha no válida en «${key}» (formato AAAA-MM-DD).`);
  return String(v);
}
function choice(d, key, options, def) {
  const v = d?.[key] || def;
  if (!options.includes(v)) fail(`Valor no válido para «${key}».`);
  return v;
}

function validateProfile(d) {
  const eq = d.equipment || [];
  const labels = CATALOG.meta.equipment_labels;
  if (!Array.isArray(eq) || eq.some((e) => !(e in labels))) fail("Lista de equipamiento no válida.");
  return {
    name: text(d, "name", 60), sex: choice(d, "sex", ["", "masculino", "femenino"], ""),
    age: num(d, "age", 14, 100, { integer: true }), height_cm: num(d, "height_cm", 120, 230, { required: true }),
    weight_kg: num(d, "weight_kg", 30, 350, { required: true }),
    activity: choice(d, "activity", Object.keys(E.constants().ACTIVITY_FACTORS), "sedentario"),
    level: choice(d, "level", Object.keys(E.constants().LEVEL_ORDER), "principiante"),
    equipment: eq, low_impact: !!d.low_impact,
  };
}

const PLAN_FIELDS = ["name", "goal", "start_date", "duration_days", "start_weight", "goal_weight", "sessions_per_week",
  "minutes_per_session", "weekly_kcal_target", "weekly_minutes_target", "notes"];

function validatePlan(d) {
  const out = {
    name: text(d, "name", 80, { required: true }),
    goal: choice(d, "goal", ["perdida_grasa", "recomposicion", "fuerza", "salud"], "perdida_grasa"),
    start_date: isoDate(d, "start_date"),
    duration_days: num(d, "duration_days", 7, 730, { required: true, integer: true }),
    start_weight: num(d, "start_weight", 30, 350), goal_weight: num(d, "goal_weight", 30, 350),
    sessions_per_week: num(d, "sessions_per_week", 1, 7, { required: true, integer: true }),
    minutes_per_session: num(d, "minutes_per_session", 10, 240, { required: true, integer: true }),
    weekly_kcal_target: num(d, "weekly_kcal_target", 0, 20000, { required: true, integer: true }),
    weekly_minutes_target: num(d, "weekly_minutes_target", 0, 3000, { required: true, integer: true }),
    notes: text(d, "notes", 2000),
  };
  if ("schedule" in d) {
    const sched = d.schedule || {};
    if (typeof sched !== "object" || Array.isArray(sched)) fail("Calendario semanal no válido.");
    const valid = new Set(S.routines.map((r) => r.id));
    const clean = {};
    for (const [wd, rid] of Object.entries(sched)) {
      if (!/^[0-6]$/.test(String(wd))) fail("Día de la semana no válido.");
      if (rid == null || rid === "" || rid === 0) continue;
      if (!valid.has(Number(rid))) fail("El calendario hace referencia a una rutina inexistente.");
      clean[String(wd)] = Number(rid);
    }
    out.schedule = clean;
  }
  return out;
}

function validateItems(items, forSession = false) {
  if (!Array.isArray(items)) fail("La lista de ejercicios no es válida.");
  if (items.length > 60) fail("Máximo 60 ejercicios por rutina/sesión.");
  return items.map((it) => {
    if (!it || typeof it !== "object") fail("Ejercicio no válido.");
    const id = String(it.exercise_id || "");
    const ex = E.exerciseById(id);
    if (!ex) fail(`Ejercicio desconocido: ${id}`);
    const c = {
      exercise_id: id,
      sets: num(it, "sets", forSession ? 0 : 1, 50, { integer: true, def: 1 }),
      reps: num(it, "reps", 0, 500, { integer: true, def: 0 }),
      duration_sec: num(it, "duration_sec", 0, 4 * 3600, { integer: true, def: 0 }),
      rest_sec: num(it, "rest_sec", 0, 900, { integer: true, def: 0 }),
      weight_kg: num(it, "weight_kg", 0, 1000, { def: 0 }),
      notes: text(it, "notes", 200),
    };
    if (c.sets > 0 && c.reps === 0 && c.duration_sec === 0) fail(`«${ex.name}»: indica repeticiones o duración.`);
    return c;
  });
}

// --------------------------------------------------------------- consultas
const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
function currentWeight() {
  if (S.weights.length) return S.weights[S.weights.length - 1].weight_kg;
  return S.profile.weight_kg ?? null;
}
const sortWeights = () => S.weights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
function listPlans() {
  return [...S.plans].sort((a, b) => (b.active - a.active) || (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : b.id - a.id));
}
const activePlan = () => S.plans.find((p) => p.active) || null;
const getRoutine = (id) => S.routines.find((r) => r.id === Number(id)) || null;
function sessionsBetween(start, end) {
  return S.sessions.filter((s) => s.date >= start && s.date <= end)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}
const summary = (e) => { const { steps_es, steps_en, attribution, ...rest } = e; return rest; };

function weekStats(start) {
  const end = E.isoFromDayNum(E.dayNum(start) + 6);
  const sessions = sessionsBetween(start, end);
  const wd = CATALOG.meta.weekdays;
  const byDay = Array.from({ length: 7 }, (_, i) => ({ date: E.isoFromDayNum(E.dayNum(start) + i), label: wd[i].slice(0, 3), kcal: 0, minutes: 0, sessions: 0 }));
  const bodyParts = {}, regions = {}, exercises = {};
  const kinds = { fuerza: 0, cardio: 0, flexibilidad: 0 };
  for (const s of sessions) {
    const d = byDay[E.dayNum(s.date) - E.dayNum(start)];
    d.kcal += s.kcal; d.minutes += s.duration_min; d.sessions += 1;
    for (const e of s.entries) {
      const ex = E.exerciseById(e.exercise_id);
      if (!ex || e.sets <= 0) continue;
      const bp = bodyParts[ex.body_part] ||= { key: ex.body_part, label: ex.body_part_es, sets: 0, minutes: 0, kcal: 0 };
      bp.sets += e.sets; bp.minutes += e.minutes; bp.kcal += e.kcal;
      kinds[ex.kind] += e.minutes;
      E.addRegionLoad(regions, ex, e.sets);
      const x = exercises[ex.id] ||= { id: ex.id, name: ex.name, pattern: ex.pattern, image: ex.image, body_part_es: ex.body_part_es,
        times: 0, sets: 0, reps: 0, minutes: 0, kcal: 0, max_weight: 0 };
      x.times += 1; x.sets += e.sets; x.reps += e.sets * e.reps; x.minutes += e.minutes; x.kcal += e.kcal;
      x.max_weight = Math.max(x.max_weight, e.weight_kg);
    }
  }
  const plan = activePlan();
  const r = (v) => E.pyRound(v);
  const totalKcal = byDay.reduce((a, d) => a + d.kcal, 0), totalMin = byDay.reduce((a, d) => a + d.minutes, 0);
  byDay.forEach((d) => { d.kcal = r(d.kcal); d.minutes = r(d.minutes); });
  return {
    start, end, sessions_count: sessions.length, active_days: byDay.filter((d) => d.sessions).length,
    kcal: r(totalKcal), minutes: r(totalMin),
    targets: { sessions: plan?.sessions_per_week ?? null, kcal: plan?.weekly_kcal_target ?? null, minutes: plan?.weekly_minutes_target ?? null },
    by_day: byDay,
    body_parts: Object.values(bodyParts).map((v) => ({ ...v, minutes: r(v.minutes), kcal: r(v.kcal) })).sort((a, b) => b.sets - a.sets),
    regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, E.pyRound(v, 1)])),
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, r(v)])),
    exercises: Object.values(exercises).map((v) => ({ ...v, minutes: r(v.minutes), kcal: r(v.kcal) })).sort((a, b) => b.kcal - a.kcal),
    sessions: structuredClone(sessions),
  };
}

function historyStats(weeks) {
  const thisWeek = E.weekStart(E.todayISO());
  const first = E.dayNum(thisWeek) - 7 * (weeks - 1);
  const out = Array.from({ length: weeks }, (_, i) => ({ start: E.isoFromDayNum(first + 7 * i), kcal: 0, minutes: 0, sessions: 0 }));
  for (const s of sessionsBetween(E.isoFromDayNum(first), E.isoFromDayNum(E.dayNum(thisWeek) + 6))) {
    const w = out[Math.floor((E.dayNum(E.weekStart(s.date)) - first) / 7)];
    w.kcal += s.kcal; w.minutes += s.duration_min; w.sessions += 1;
  }
  out.forEach((w) => { w.kcal = E.pyRound(w.kcal); w.minutes = E.pyRound(w.minutes); });
  return out;
}

function profileView() {
  const w = currentWeight();
  return { ...structuredClone(S.profile), current_weight: w, metrics: E.bodyMetrics(S.profile, w) };
}
const planView = (p) => ({ ...structuredClone(p), guidance: E.planGuidance(p, currentWeight(), E.todayISO()) });
const routineView = (r) => ({ ...structuredClone(r), estimate: E.estimateItems(r.items, currentWeight() || 80) });

function dashboard() {
  const today = E.todayISO(), weight = currentWeight(), plan = activePlan();
  const week = weekStats(E.weekStart(today));
  delete week.sessions;
  const out = {
    today, weekday: E.weekdayOf(today), profile: structuredClone(S.profile), weight,
    metrics: E.bodyMetrics(S.profile, weight), plan: plan ? structuredClone(plan) : null,
    guidance: plan ? E.planGuidance(plan, weight, today) : null, week, history: historyStats(12),
    today_routine: null, today_done: false, backup_reminder: null,
  };
  if (plan) {
    const rid = plan.schedule[String(out.weekday)];
    const r = rid && getRoutine(rid);
    if (r) {
      out.today_routine = routineView(r);
      out.today_done = sessionsBetween(today, today).some((s) => s.routine_id === r.id);
    }
  }
  // Recordatorio de copia de seguridad: los datos solo viven en este dispositivo.
  if (S.sessions.length || S.weights.length > 1) {
    const last = S.meta.last_export ? E.dayNum(S.meta.last_export.slice(0, 10)) : null;
    const days = last == null ? null : E.dayNum(today) - last;
    if (days == null || days >= 14) out.backup_reminder = { days };
  }
  return out;
}

function buildSession(d) {
  let entries = validateItems(d.entries || [], true).filter((e) => e.sets > 0);
  if (!entries.length) fail("Registra al menos un ejercicio con una serie completada.");
  const weight = num(d, "body_weight", 30, 350) || currentWeight() || 80;
  const est = E.estimateItems(entries, weight);
  entries = entries.map((e, i) => ({ ...e, minutes: est.items[i].minutes, kcal: est.items[i].kcal }));
  const duration = num(d, "duration_min", 1, 600);
  const estKcal = entries.reduce((a, e) => a + e.kcal, 0);
  let kcal = estKcal;
  if (duration && est.minutes > 0) {
    const factor = Math.max(0.5, Math.min(1.5, duration / est.minutes));
    kcal = estKcal * factor;
    entries.forEach((e) => { e.kcal = E.pyRound(e.kcal * factor, 1); e.minutes = E.pyRound(e.minutes * factor, 1); });
  }
  let routineId = d.routine_id;
  routineId = routineId == null || routineId === "" || routineId === 0 ? null : getRoutine(routineId) ? Number(routineId) : null;
  const session = {
    date: isoDate(d, "date", { def: E.todayISO() }), routine_id: routineId, name: text(d, "name", 80) || "Entrenamiento",
    duration_min: E.pyRound((duration || est.minutes), 1), kcal: E.pyRound(kcal, 1),
    rpe: num(d, "rpe", 1, 10, { integer: true }), body_weight: weight, notes: text(d, "notes", 2000),
  };
  return { session, entries: entries.map(({ notes, ...e }) => e) };
}

function upsertWeight(w) {
  const i = S.weights.findIndex((x) => x.date === w.date);
  if (i >= 0) S.weights[i] = w; else S.weights.push(w);
  sortWeights();
}

function activateLatestIfNone() {
  if (!S.plans.some((p) => p.active) && S.plans.length) {
    const latest = [...S.plans].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
    latest.active = true;
  }
}

// --------------------------------------------------------- copias (formato del PC)
function exportAll() {
  const plans = [], schedule = [], routines = [], items = [], sessions = [], entries = [];
  for (const p of S.plans) {
    const { schedule: sc, active, ...rest } = p;
    plans.push({ ...rest, active: active ? 1 : 0 });
    for (const [wd, rid] of Object.entries(sc || {})) schedule.push({ plan_id: p.id, weekday: Number(wd), routine_id: rid });
  }
  for (const r of S.routines) {
    const { items: its, ...rest } = r;
    routines.push(rest);
    its.forEach((it, pos) => items.push({ ...it, routine_id: r.id, position: pos }));
  }
  for (const s of S.sessions) {
    const { entries: es, ...rest } = s;
    sessions.push(rest);
    es.forEach((e, pos) => entries.push({ ...e, session_id: s.id, position: pos }));
  }
  const p = S.profile;
  return {
    app: "FitPlan", schema_version: 1, exported_from: "movil", exported_at: new Date().toISOString(),
    tables: {
      profile: [{ ...p, equipment: JSON.stringify(p.equipment || []), low_impact: p.low_impact ? 1 : 0 }],
      plans, routines, routine_items: items, schedule, sessions, session_entries: entries, weights: structuredClone(S.weights),
    },
  };
}

function importAll(data) {
  if (data?.app !== "FitPlan" || !data.tables) fail("El archivo no es una copia de seguridad válida de FitPlan.");
  const t = data.tables;
  const arr = (k) => (Array.isArray(t[k]) ? t[k] : []);
  const pr = arr("profile")[0] || {};
  let eq = pr.equipment ?? [];
  if (typeof eq === "string") { try { eq = JSON.parse(eq); } catch { eq = []; } }
  const profile = { ...DEFAULT_PROFILE(), ...pr, id: 1, equipment: Array.isArray(eq) ? eq : [], low_impact: !!pr.low_impact };
  const plans = arr("plans").map((p) => ({ ...p, active: !!p.active, schedule: {} }));
  for (const s of arr("schedule")) {
    const p = plans.find((x) => x.id === s.plan_id);
    if (p && s.routine_id) p.schedule[String(s.weekday)] = s.routine_id;
  }
  const routines = arr("routines").map((r) => ({ ...r, items: [] }));
  for (const it of [...arr("routine_items")].sort((a, b) => a.position - b.position)) {
    routines.find((r) => r.id === it.routine_id)?.items.push(it);
  }
  const sessions = arr("sessions").map((s) => ({ ...s, entries: [] }));
  for (const e of [...arr("session_entries")].sort((a, b) => a.position - b.position)) {
    sessions.find((s) => s.id === e.session_id)?.entries.push(e);
  }
  const maxId = (xs) => xs.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
  Object.assign(S, {
    profile, plans, routines, sessions,
    weights: arr("weights").map((w) => ({ date: w.date, weight_kg: w.weight_kg, waist_cm: w.waist_cm ?? null, note: w.note || "" })),
    seq: { plan: maxId(plans), routine: maxId(routines), session: maxId(sessions), item: maxId(arr("routine_items")), entry: maxId(arr("session_entries")) },
  });
  sortWeights();
}

// ------------------------------------------------------------------ rutas
const ROUTES = [];
const route = (method, pattern, fn) => ROUTES.push([method, new RegExp(`^${pattern}$`), fn]);

route("GET", "/api/health", () => ({ ok: true, app: "FitPlan" }));
route("GET", "/api/meta", () => CATALOG.meta);
route("GET", "/api/exercises", () => CATALOG.exercises.map(summary));
route("GET", "/api/exercises/(\\w+)", (q, b, id) => {
  const ex = E.exerciseById(id);
  if (!ex) fail("Ejercicio no encontrado.");
  const w = currentWeight() || 80;
  return { ...ex, kcal_10min: E.pyRound(E.kcalPerMin(ex.met, w) * 10), weight_ref: w };
});
route("GET", "/api/dashboard", () => dashboard());

route("GET", "/api/profile", () => profileView());
route("PUT", "/api/profile", async (q, b) => {
  const data = validateProfile(b);
  const firstTime = !S.weights.length;
  const changed = currentWeight() !== data.weight_kg;
  Object.assign(S.profile, data, { updated_at: nowStamp() });
  if (firstTime || changed) upsertWeight({ date: E.todayISO(), weight_kg: data.weight_kg, waist_cm: null, note: firstTime ? "Peso inicial" : "Actualizado desde el perfil" });
  await save("profile", "weights");
  return profileView();
});

route("GET", "/api/weights", () => structuredClone(S.weights));
route("POST", "/api/weights", async (q, b) => {
  upsertWeight({ date: isoDate(b, "date"), weight_kg: num(b, "weight_kg", 30, 350, { required: true }),
    waist_cm: num(b, "waist_cm", 40, 250), note: text(b, "note", 200) });
  await save("weights");
  return structuredClone(S.weights);
});
route("DELETE", "/api/weights/(\\d{4}-\\d{2}-\\d{2})", async (q, b, day) => {
  S.weights = S.weights.filter((w) => w.date !== day);
  await save("weights");
  return structuredClone(S.weights);
});

route("GET", "/api/plans", () => listPlans().map(planView));
route("POST", "/api/plans/suggest-kcal", (q, b) => {
  const s = num(b, "sessions_per_week", 1, 7, { required: true, integer: true });
  const m = num(b, "minutes_per_session", 10, 240, { required: true, integer: true });
  return { weekly_kcal_target: E.suggestWeeklyKcal(s, m, currentWeight() || 80), weekly_minutes_target: s * m };
});
route("POST", "/api/plans", async (q, b) => {
  const d = validatePlan(b);
  const plan = { id: nextId("plan"), ...Object.fromEntries(PLAN_FIELDS.map((f) => [f, d[f]])), schedule: d.schedule || {},
    active: !S.plans.some((p) => p.active), created_at: nowStamp() };
  S.plans.push(plan);
  await save("plans", "seq");
  return structuredClone(plan);
});
route("PUT", "/api/plans/(\\d+)", async (q, b, id) => {
  const plan = S.plans.find((p) => p.id === Number(id));
  if (!plan) fail("Plan no encontrado.");
  const d = validatePlan(b);
  PLAN_FIELDS.forEach((f) => { plan[f] = d[f]; });
  if (d.schedule) plan.schedule = d.schedule;
  await save("plans");
  return structuredClone(plan);
});
route("POST", "/api/plans/(\\d+)/activate", async (q, b, id) => {
  if (!S.plans.some((p) => p.id === Number(id))) fail("Plan no encontrado.");
  S.plans.forEach((p) => { p.active = p.id === Number(id); });
  await save("plans");
  return { ok: true };
});
route("DELETE", "/api/plans/(\\d+)", async (q, b, id) => {
  S.plans = S.plans.filter((p) => p.id !== Number(id));
  activateLatestIfNone();
  await save("plans");
  return { ok: true };
});
route("POST", "/api/plans/(\\d+)/generate", async (q, b, id) => {
  const plan = S.plans.find((p) => p.id === Number(id));
  if (!plan) fail("Plan no encontrado.");
  const p = S.profile;
  const layout = plan.sessions_per_week >= 2 ? E.weekLayout(plan.sessions_per_week) : { 0: "full_a" };
  const created = {}, schedule = {};
  const seed = Math.floor(Date.now() / 1000);
  for (const [wd, tpl] of Object.entries(layout)) {
    if (!(tpl in created)) {
      const sug = E.suggestRoutine(tpl, plan.minutes_per_session, p.equipment, p.level, p.low_impact, seed + Number(wd));
      const r = { id: nextId("routine"), name: `${sug.name} · ${plan.name}`.slice(0, 80),
        description: `Generada automáticamente para el plan «${plan.name}».`, created_at: nowStamp(), updated_at: nowStamp(),
        items: validateItems(sug.items) };
      S.routines.push(r);
      created[tpl] = r.id;
    }
    schedule[String(wd)] = created[tpl];
  }
  plan.schedule = schedule;
  await save("routines", "plans", "seq");
  return structuredClone(plan);
});

route("GET", "/api/routines", () => [...S.routines].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })).map(routineView));
route("POST", "/api/routines", async (q, b) => {
  const r = { id: nextId("routine"), name: text(b, "name", 80, { required: true }), description: text(b, "description", 1000),
    items: validateItems(b.items || []), created_at: nowStamp(), updated_at: nowStamp() };
  S.routines.push(r);
  await save("routines", "seq");
  return structuredClone(r);
});
route("PUT", "/api/routines/(\\d+)", async (q, b, id) => {
  const r = getRoutine(id);
  if (!r) fail("Rutina no encontrada.");
  const name = text(b, "name", 80, { required: true }), description = text(b, "description", 1000), items = validateItems(b.items || []);
  Object.assign(r, { name, description, items, updated_at: nowStamp() });
  await save("routines");
  return structuredClone(r);
});
route("DELETE", "/api/routines/(\\d+)", async (q, b, id) => {
  const rid = Number(id);
  S.routines = S.routines.filter((r) => r.id !== rid);
  S.plans.forEach((p) => { for (const [wd, x] of Object.entries(p.schedule)) if (x === rid) delete p.schedule[wd]; });
  S.sessions.forEach((s) => { if (s.routine_id === rid) s.routine_id = null; });
  await save("routines", "plans", "sessions");
  return { ok: true };
});
route("POST", "/api/routines/suggest", (q, b) => {
  const p = S.profile;
  const tpl = choice(b, "template", Object.keys(E.constants().TEMPLATES), "full_a");
  const minutes = num(b, "minutes", 10, 240, { integer: true, def: 45 });
  const seed = num(b, "seed", 0, 1e12, { integer: true });
  return E.suggestRoutine(tpl, minutes, p.equipment, p.level, p.low_impact, seed);
});
route("POST", "/api/estimate", (q, b) => {
  const items = validateItems(b.items || [], true);
  return E.estimateItems(items, num(b, "body_weight", 30, 350) || currentWeight() || 80);
});

route("GET", "/api/sessions", (q) => {
  const start = isoDate({ d: q.get("from") || E.isoFromDayNum(E.dayNum(E.todayISO()) - 30) }, "d");
  const end = isoDate({ d: q.get("to") || E.todayISO() }, "d");
  return structuredClone(sessionsBetween(start, end));
});
route("POST", "/api/sessions", async (q, b) => {
  const { session, entries } = buildSession(b);
  const s = { id: nextId("session"), ...session, created_at: nowStamp(), entries };
  S.sessions.push(s);
  await save("sessions", "seq");
  return { id: s.id, ...session };
});
route("PUT", "/api/sessions/(\\d+)", async (q, b, id) => {
  const s = S.sessions.find((x) => x.id === Number(id));
  if (!s) fail("Sesión no encontrada.");
  const { session, entries } = buildSession(b);
  Object.assign(s, session, { entries });
  await save("sessions");
  return { id: s.id, ...session };
});
route("DELETE", "/api/sessions/(\\d+)", async (q, b, id) => {
  S.sessions = S.sessions.filter((s) => s.id !== Number(id));
  await save("sessions");
  return { ok: true };
});

route("GET", "/api/stats/week", (q) => {
  const d = q.get("start");
  return weekStats(E.weekStart(d ? isoDate({ d }, "d") : E.todayISO()));
});
route("GET", "/api/stats/history", (q) => historyStats(num({ w: q.get("weeks") || "12" }, "w", 1, 104, { integer: true })));

route("GET", "/api/backup", async () => {
  const data = exportAll();
  S.meta.last_export = new Date().toISOString();
  await save("meta");
  return data;
});
route("POST", "/api/restore", async (q, b) => {
  importAll(b);
  await save("profile", "plans", "routines", "sessions", "weights", "seq");
  return { ok: true };
});

/** Punto de entrada: mismo contrato que fetch() contra el servidor del PC. */
export async function handle(method, url, body) {
  await ready();
  const u = new URL(url, location.href);
  for (const [m, rx, fn] of ROUTES) {
    const match = rx.exec(u.pathname.replace(/^.*(?=\/api\/)/, ""));
    if (match && m === method) {
      try {
        return await fn(u.searchParams, body || {}, ...match.slice(1));
      } catch (err) {
        if (err instanceof ApiError) throw err;
        console.error(err);
        await loadAll().catch(() => {}); // descarta cambios en memoria no guardados
        throw new Error(err?.message || "Error interno de la aplicación.");
      }
    }
  }
  throw new Error("Ruta no encontrada.");
}
