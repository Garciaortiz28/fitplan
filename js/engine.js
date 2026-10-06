// Motor de FitPlan en JavaScript (versión móvil).
// Port fiel de app/engine.py. Las constantes (básicos, plantillas, factores...) se generan
// desde Python en data/engine.json, así que existe una única fuente de verdad para los datos.

let C = null;        // constantes de engine.json
let BY_ID = null;    // Map id -> ejercicio
let ITEMS = null;    // lista del catálogo

export function initEngine(constants, exercises) {
  C = constants;
  ITEMS = exercises;
  BY_ID = new Map(exercises.map((e) => [e.id, e]));
}
export const exerciseById = (id) => BY_ID.get(String(id));

const int = (v) => Math.trunc(Number(v) || 0);

/**
 * Redondeo idéntico a round() de Python: correcto sobre el valor decimal exacto del número
 * y, en empates exactos, al par más cercano (3,25 -> 3,2; 2,5 -> 2).
 */
export function pyRound(x, d = 0) {
  if (!Number.isFinite(x)) return x;
  const ax = Math.abs(x), sign = x < 0 ? -1 : 1;
  const exact = ax.toFixed(Math.min(100, d + 40)); // expansión decimal exacta del double
  const [ip, fp = ""] = exact.split(".");
  const tail = fp.slice(d);
  let v;
  if (tail[0] === "5" && /^0*$/.test(tail.slice(1))) {
    const kept = BigInt(ip + fp.slice(0, d));
    v = Number(kept % 2n === 1n ? kept + 1n : kept) / 10 ** d;
  } else {
    v = Number(ax.toFixed(d));
  }
  return sign * v || 0;
}
const round = pyRound;
const has = (name, kws) => kws.some((k) => name.includes(k));

// ------------------------------------------------------------- calorías
export const kcalPerMin = (met, w) => (met * 3.5 * w) / 200;

export function estimateEntry(ex, item, w) {
  const sets = Math.max(0, int(item.sets)), reps = Math.max(0, int(item.reps));
  const dur = Math.max(0, int(item.duration_sec)), rest = Math.max(0, int(item.rest_sec));
  const workSec = sets * (dur > 0 ? dur : reps * C.SECONDS_PER_REP);
  const restSec = rest * Math.max(sets - 1, 0);
  const workMin = workSec / 60, restMin = restSec / 60;
  const kcal = ex.kind === "cardio"
    ? kcalPerMin(ex.met, w) * workMin + kcalPerMin(C.REST_MET, w) * restMin
    : kcalPerMin(ex.met, w) * (workMin + restMin);
  return { minutes: round(workMin + restMin, 1), kcal: round(kcal, 1) };
}

export function addRegionLoad(acc, ex, sets) {
  if (sets <= 0) return;
  acc[ex.primary_region] = (acc[ex.primary_region] || 0) + sets;
  for (const r of ex.secondary_regions) acc[r] = (acc[r] || 0) + sets * 0.5;
}

export function estimateItems(items, w) {
  let totalMin = 0, totalKcal = 0;
  const regions = {}, perItem = [];
  for (const it of items) {
    const ex = BY_ID.get(String(it.exercise_id));
    if (!ex) { perItem.push({ minutes: 0, kcal: 0 }); continue; }
    const est = estimateEntry(ex, it, w);
    perItem.push(est);
    totalMin += est.minutes;
    totalKcal += est.kcal;
    addRegionLoad(regions, ex, Math.max(0, int(it.sets)));
  }
  const transitions = Math.max(items.length - 1, 0);
  return {
    items: perItem,
    minutes: round(totalMin + transitions),
    kcal: round(totalKcal),
    regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, round(v, 1)])),
  };
}

// ------------------------------------------------------ métricas corporales
export function bodyMetrics(profile, w) {
  const h = profile.height_cm;
  const out = { bmi: null, bmi_class: null, bmr: null, tdee: null, healthy_min: null, healthy_max: null };
  if (!h || !w) return out;
  const hm = h / 100, bmi = w / (hm * hm);
  const cls = bmi < 18.5 ? "Bajo peso" : bmi < 25 ? "Peso saludable" : bmi < 30 ? "Sobrepeso"
    : bmi < 35 ? "Obesidad grado I" : bmi < 40 ? "Obesidad grado II" : "Obesidad grado III";
  Object.assign(out, { bmi: round(bmi, 1), bmi_class: cls, healthy_min: round(18.5 * hm * hm, 1), healthy_max: round(24.9 * hm * hm, 1) });
  const { age, sex } = profile;
  if (age && (sex === "masculino" || sex === "femenino")) {
    const bmr = 10 * w + 6.25 * h - 5 * age + (sex === "masculino" ? 5 : -161);
    out.bmr = round(bmr);
    out.tdee = round(bmr * (C.ACTIVITY_FACTORS[profile.activity || "sedentario"] ?? 1.2));
  }
  return out;
}

// --------------------------------------------------------------- fechas
export const dayNum = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const isoFromDayNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const weekdayOf = (iso) => (((dayNum(iso) + 3) % 7) + 7) % 7; // 1970-01-01 fue jueves -> lunes = 0
export const weekStart = (iso) => isoFromDayNum(dayNum(iso) - weekdayOf(iso));

// ------------------------------------------------------------------ plan
export function planGuidance(plan, currentWeight, today) {
  const start = dayNum(plan.start_date), days = int(plan.duration_days);
  const elapsed = dayNum(today) - start + 1;
  const dayN = Math.max(0, Math.min(elapsed, days));
  const frac = days ? dayN / days : 0;
  let phase;
  if (elapsed < 1) {
    const [y, m, d] = plan.start_date.split("-");
    phase = { key: "pendiente", name: "Por comenzar", tip: `El plan empieza el ${d}/${m}/${y}.` };
  } else if (frac <= 0.25) phase = { key: "adaptacion", ...C.PHASES.adaptacion };
  else if (frac <= 0.75) phase = { key: "progresion", ...C.PHASES.progresion };
  else if (elapsed <= days) phase = { key: "consolidacion", ...C.PHASES.consolidacion };
  else phase = { key: "finalizado", ...C.PHASES.finalizado };

  const out = { day: dayN, days, elapsed, progress: round(frac * 100, 1), phase,
    end_date: isoFromDayNum(start + days - 1), weekly_loss_needed: null, safe_min: null, safe_max: null, feasibility: null };
  const sw = plan.start_weight, gw = plan.goal_weight;
  if (sw && gw && days) {
    const needed = (sw - gw) / (days / 7);
    const ref = currentWeight || sw;
    const safeMin = 0.005 * ref, safeMax = 0.01 * ref;
    Object.assign(out, { weekly_loss_needed: round(needed, 2), safe_min: round(safeMin, 2), safe_max: round(safeMax, 2) });
    out.feasibility = needed <= 0 ? { level: "info", text: "El objetivo no implica pérdida de peso." }
      : needed <= safeMax ? { level: "good", text: "Ritmo realista y saludable (≤1 % del peso por semana)." }
      : needed <= safeMax * 1.3 ? { level: "warning", text: "Ritmo exigente: requiere déficit alimentario consistente además del ejercicio." }
      : { level: "critical", text: "Ritmo demasiado agresivo: alarga el plan o ajusta el peso objetivo para proteger masa muscular y salud." };
    out.exercise_kg_week = round((plan.weekly_kcal_target || 0) / C.KCAL_PER_KG_FAT, 2);
  }
  return out;
}

export function suggestWeeklyKcal(sessions, minutes, w) {
  return Math.trunc(round((sessions * minutes * kcalPerMin(4.5, w) * 0.85) / 50) * 50);
}

// ------------------------------------------------------ generador de rutinas
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allowed(e, eq, level, maxImpact) {
  if (eq.size && !eq.has(e.equipment)) return false;
  if (C.LEVEL_ORDER[e.difficulty] > (C.LEVEL_ORDER[level] ?? 0)) return false;
  return C.IMPACT_ORDER[e.impact] <= (C.IMPACT_ORDER[maxImpact] ?? 2);
}

function candidates(slot, eq, level, maxImpact) {
  const spec = C.SLOTS[slot];
  return ITEMS.filter((e) => {
    if (slot === "cardio") { if (e.kind !== "cardio") return false; }
    else if (e.kind !== "fuerza" || !spec.targets.includes(e.target) || !has(e.name.toLowerCase(), spec.kw)) return false;
    return allowed(e, eq, level, maxImpact);
  });
}

function simplicityPenalty(e) {
  const name = e.name.toLowerCase();
  return C.ODD_KW.filter((k) => name.includes(k)).length * 1.5 + Math.max(0, name.split(/\s+/).length - 4) * 0.5;
}

export function suggestRoutine(template, minutes, equipment, level, lowImpact, seed) {
  const tpl = C.TEMPLATES[template] || C.TEMPLATES.full_a;
  const rng = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));
  const choice = (arr) => arr[Math.floor(rng() * arr.length)];
  const eq = new Set(equipment || []);
  const maxImpact = lowImpact ? "bajo" : level === "principiante" ? "medio" : "alto";
  const used = new Set();
  const items = [], notes = [];
  const isCircuit = template === "circuito";
  const budget = Math.max(15, int(minutes || 45));
  const eqBw = eq.size ? new Set([...eq, "body weight"]) : eq;
  const WALK = C.WALK_ID;

  const slots = [...tpl.slots.filter((s) => s !== "cardio"), ...tpl.slots.filter((s) => s === "cardio")];
  for (const slot of slots) {
    const staples = (C.STAPLES[slot] || []).filter((i) => BY_ID.has(i)).map((i) => BY_ID.get(i));
    const pool = staples.filter((e) => !used.has(e.id) && allowed(e, eqBw, level, maxImpact));
    let pick;
    if (pool.length) pick = choice(pool.slice(0, 3));
    else if (slot === "cardio" && used.has(WALK)) continue;
    else if (slot === "cardio" && BY_ID.has(WALK)) {
      pick = BY_ID.get(WALK);
      notes.push("Sin máquinas de cardio: realiza el bloque de «walking on incline treadmill» como caminata rápida al aire libre, idealmente con cuestas (gasto similar).");
    } else {
      let cands = candidates(slot, eqBw, level, maxImpact);
      if (!cands.length) cands = candidates(slot, new Set(), level, maxImpact);
      cands = cands.filter((c) => !used.has(c.id));
      if (!cands.length) { notes.push(`Sin ejercicio disponible para «${C.SLOTS[slot].label}» con tu configuración.`); continue; }
      const key = slot === "cardio" ? (c) => c.calorie_score : (c) => c.muscle_score;
      cands.sort((a, b) => (key(b) - simplicityPenalty(b)) - (key(a) - simplicityPenalty(a)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      pick = choice(cands.slice(0, 3));
      if (eq.size && !eqBw.has(pick.equipment)) {
        notes.push(`«${pick.name}» requiere ${pick.equipment_es.toLowerCase()}, que no está en tu equipamiento: cámbialo si no dispones de él.`);
      }
    }
    used.add(pick.id);

    let item;
    if (slot === "cardio") item = { ...pick.default };
    else if (level === "principiante") item = { sets: isCircuit ? 2 : 3, reps: pick.compound ? 12 : 15, duration_sec: 0, rest_sec: pick.compound ? 75 : 60 };
    else if (level === "intermedio") item = { sets: pick.compound ? 4 : 3, reps: pick.compound ? 10 : 12, duration_sec: 0, rest_sec: pick.compound ? 90 : 60 };
    else item = { sets: 4, reps: pick.compound ? 8 : 12, duration_sec: 0, rest_sec: pick.compound ? 120 : 75 };
    if (slot === "core" && has(pick.name.toLowerCase(), ["plank", "hold", "hollow"])) Object.assign(item, { reps: 0, duration_sec: 30 });
    if (isCircuit && slot !== "cardio") item.rest_sec = 30;
    Object.assign(item, { exercise_id: pick.id, weight_kg: 0, notes: C.SLOTS[slot].label });
    items.push(item);
  }

  const WREF = 80;
  let spent = estimateItems(items, WREF).minutes;
  const isSteady = (i) => items[i].sets === 1 && BY_ID.get(items[i].exercise_id).impact === "bajo";
  const cardioIdx = items.map((it, i) => (BY_ID.get(it.exercise_id).kind === "cardio" ? i : -1)).filter((i) => i >= 0);
  if (cardioIdx.length && !cardioIdx.some(isSteady) && budget - spent >= 8 && BY_ID.has(WALK) && !used.has(WALK)) {
    const walk = BY_ID.get(WALK);
    items.push({ ...walk.default, duration_sec: 0, exercise_id: WALK, weight_kg: 0, notes: "Cardio continuo" });
    used.add(WALK);
    cardioIdx.push(items.length - 1);
    spent += 1;
    if (eq.size && !eq.has(walk.equipment)) notes.push("Bloque final de caminata: en cinta inclinada o al aire libre con cuestas.");
  }
  if (cardioIdx.length) {
    const steady = cardioIdx.filter(isSteady);
    if (steady.length) {
      const per = ((budget - spent) * 60) / steady.length;
      for (const i of steady) items[i].duration_sec = Math.floor(Math.max(300, Math.min(3600, items[i].duration_sec + per)) / 60) * 60;
    }
  } else {
    while (items.length > 3 && estimateItems(items, WREF).minutes > budget * 1.15) items.pop();
  }
  return { name: tpl.name, template, items, notes };
}

export const templatesList = () => Object.entries(C.TEMPLATES).map(([key, v]) => ({ key, name: v.name }));
export const weekLayout = (n) => C.WEEK_LAYOUTS[String(n)] || { 0: "full_a" };
export const constants = () => C;
