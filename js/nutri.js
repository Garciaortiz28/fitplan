// Motor de nutrición de FitPlan (compartido por la versión de PC y la del iPhone).
// Calcula metas diarias, porciones recomendadas, evaluación por horario (hora de Colombia),
// sugerencias de comidas colombianas, asistente de antojos y gasto energético adaptativo.

let FOODS = null;

export async function loadFoods() {
  if (!FOODS) {
    const r = await fetch("data/foods.json");
    if (!r.ok) throw new Error("No se pudo cargar la base de alimentos.");
    FOODS = await r.json();
    FOODS.byId = new Map(FOODS.foods.map((f) => [f.id, f]));
  }
  return FOODS;
}
export const foodsDB = () => FOODS;

/** Alimento propio (PC/iPhone) en el mismo formato que la base TCAC. */
export function customToFood(c) {
  return {
    id: `U:${c.id}`, n: c.brand ? `${c.name} (${c.brand})` : c.name, g: "U", src: c.source === "off" ? "off" : "propio",
    k: c.kcal, p: c.prot, f: c.fat, c: c.carb, fi: c.fiber, role: c.role || "otro", fl: c.flags || [],
    m: c.unit_name && c.unit_grams ? [[c.unit_name, c.unit_grams]] : [["1 porción", 100]], barcode: c.barcode,
  };
}

export const ROLE_LABEL = {
  almidon: "Cereal / tubérculo", proteina: "Proteína", verdura: "Verdura", fruta: "Fruta", lacteo: "Lácteo",
  grasa: "Grasa", dulce: "Dulce / antojo", bebida: "Bebida", leguminosa: "Leguminosa", plato: "Plato completo", otro: "Otro",
};
export const MEAL_LABEL = { desayuno: "Desayuno", almuerzo: "Almuerzo", comida: "Comida", extra: "Antojos y extras" };
const MEAL_PHRASE = { desayuno: "tu desayuno", almuerzo: "tu almuerzo", comida: "tu comida", extra: "tu margen de extras" };

/** Nombre corto y reconocible: «Queso madurado, blando, magro, tipo cottage…» → «Queso madurado, tipo cottage». */
export function shortName(n) {
  const seg = String(n).split(", ");
  if (seg.length <= 2) return n;
  const tipo = seg.find((s) => s.startsWith("tipo "));
  return `${seg[0]}, ${tipo || seg[1]}`;
}
export const PACE = {
  suave: { pct: 0.005, label: "Suave (0,5 % del peso/semana)" },
  moderado: { pct: 0.0075, label: "Moderado (0,75 % del peso/semana)" },
  rapido: { pct: 0.01, label: "Rápido (1 % del peso/semana)" },
};
const ACTIVITY = { sedentario: 1.2, ligero: 1.375, moderado: 1.55, activo: 1.725, muy_activo: 1.9 };

const r1 = (v) => Math.round(v * 10) / 10;
const round5 = (v) => Math.max(5, Math.round(v / 5) * 5);
export const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
export const fromMin = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

/** Nutrientes de una porción (g) de un alimento (valores por 100 g). */
export function portion(food, grams) {
  const f = grams / 100;
  return { kcal: Math.round((food.k || 0) * f), prot: r1((food.p || 0) * f), fat: r1((food.f || 0) * f),
    carb: r1((food.c || 0) * f), fiber: r1((food.fi || 0) * f) };
}

/** Medida casera más cercana a unos gramos («≈ 1 taza»). */
export function nearestMeasure(food, grams) {
  const ms = food.m || [];
  if (!ms.length) return "";
  let best = null;
  for (const [label, g] of ms) {
    for (const mult of [0.5, 1, 1.5, 2, 3]) {
      const d = Math.abs(g * mult - grams) / grams;
      if (!best || d < best.d) best = { d, label, mult };
    }
  }
  if (!best || best.d > 0.2) return "";
  const m = best.mult === 1 ? "" : best.mult === 0.5 ? "½ × " : `${String(best.mult).replace(".", ",")} × `;
  return `≈ ${m}${best.label}`;
}

// ---------------------------------------------------------------- metas diarias

/**
 * Metas del día a partir del perfil, el plan de entrenamiento y los ajustes.
 * adaptFactor (0,85-1,15) corrige el gasto según tu evolución real de peso.
 */
export function computeTargets({ profile, weight, plan, settings, adaptFactor = 1, today }) {
  const h = profile?.height_cm, age = profile?.age, sex = profile?.sex;
  if (!h || !weight) return { ok: false, reason: "Completa altura y peso en Plan y perfil." };
  if (!age || !["masculino", "femenino"].includes(sex)) return { ok: false, reason: "Indica sexo y edad en Plan y perfil para calcular tu gasto diario." };

  const bmr = 10 * weight + 6.25 * h - 5 * age + (sex === "masculino" ? 5 : -161);
  const formulaBase = bmr * (ACTIVITY[profile.activity] || 1.2);
  const base = formulaBase * adaptFactor;                         // gasto diario sin ejercicio
  const exerciseDay = plan ? (plan.weekly_kcal_target || 0) / 7 : 0;

  // Ritmo de pérdida: el elegido, sin pasar de lo que falta para la meta del plan.
  let weeklyLoss = (PACE[settings.pace] || PACE.moderado).pct * weight;
  let goalReached = false;
  if (plan?.goal_weight) {
    const end = new Date(plan.start_date + "T12:00:00");
    end.setDate(end.getDate() + plan.duration_days - 1);
    const weeksLeft = Math.max(1, (end - new Date(today + "T12:00:00")) / (7 * 86400000));
    const needed = (weight - plan.goal_weight) / weeksLeft;
    if (weight <= plan.goal_weight) { weeklyLoss = 0; goalReached = true; }
    else weeklyLoss = Math.min(weeklyLoss, Math.max(needed, 0.25 * weeklyLoss));
  }
  const totalDeficit = (weeklyLoss * 7700) / 7;
  let foodDeficit = totalDeficit - exerciseDay;
  foodDeficit = goalReached ? 0 : Math.min(Math.max(foodDeficit, 250), 1000, 0.25 * base);
  const floor = Math.max(sex === "femenino" ? 1200 : 1500, Math.round(bmr * 0.8));
  let kcal = Math.round((base - foodDeficit) / 50) * 50;
  const floored = kcal < floor;
  if (floored) kcal = Math.round(floor / 50) * 50;

  // Proteína sobre peso ajustado (en obesidad no se usa el peso total).
  const ibw = 22.5 * (h / 100) ** 2;
  const refW = weight > ibw * 1.2 ? ibw + 0.4 * (weight - ibw) : weight;
  const prot = Math.round(refW * settings.protein_g_per_kg);
  const fat = Math.round((kcal * settings.fat_pct) / 100 / 9);
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  const split = settings.split;
  const meals = Object.fromEntries(Object.keys(MEAL_LABEL).map((m) => [m, Math.round((kcal * (split[m] || 0)) / 100)]));
  return {
    ok: true, kcal, prot, fat, carb, fiber: Math.round((14 * kcal) / 1000), meals, extra: meals.extra,
    bmr: Math.round(bmr), base: Math.round(base), formulaBase: Math.round(formulaBase), adaptFactor,
    exerciseDay: Math.round(exerciseDay), foodDeficit: Math.round(base - kcal), floored, goalReached,
    expectedWeeklyLoss: r1(((base - kcal + exerciseDay) * 7) / 7700),
  };
}

// --------------------------------------------------------------- estado del día

export function dayState(logs, targets) {
  const tot = { kcal: 0, prot: 0, fat: 0, carb: 0, fiber: 0, antojo: 0 };
  const byMeal = Object.fromEntries(Object.keys(MEAL_LABEL).map((m) => [m, { kcal: 0, items: [] }]));
  for (const l of logs) {
    for (const k of ["kcal", "prot", "fat", "carb", "fiber"]) tot[k] += l[k] || 0;
    if ((l.flags || []).includes("antojo")) tot.antojo += l.kcal;
    const m = byMeal[l.meal] || byMeal.extra;
    m.kcal += l.kcal;
    m.items.push(l);
  }
  for (const k of Object.keys(tot)) tot[k] = r1(tot[k]);
  return { tot, byMeal, remaining: targets?.ok ? Math.round(targets.kcal - tot.kcal) : null };
}

/** Comida que corresponde a una hora, según el horario configurado. */
export function mealForTime(minutes, settings) {
  const d = toMin(settings.meals.desayuno), a = toMin(settings.meals.almuerzo), c = toMin(settings.meals.comida);
  if (minutes < toMin(settings.wake) - 30) return "extra";
  if (minutes < (d + a) / 2) return "desayuno";
  if (minutes < (a + c) / 2) return "almuerzo";
  if (minutes <= c + 150) return "comida";
  return "extra";
}

/** Próxima comida y minutos que faltan. */
export function nextMeal(minutes, settings) {
  for (const m of ["desayuno", "almuerzo", "comida"]) {
    const t = toMin(settings.meals[m]);
    if (minutes <= t + 45) return { meal: m, time: settings.meals[m], inMin: t - minutes };
  }
  return { meal: "desayuno", time: settings.meals.desayuno, inMin: toMin(settings.meals.desayuno) + 1440 - minutes, tomorrow: true };
}

// ---------------------------------------------------------- porción recomendada

const ROLE_SHARE = { proteina: 0.32, almidon: 0.3, leguminosa: 0.22, verdura: 0.08, fruta: 0.12, lacteo: 0.15, grasa: 0.1, bebida: 0.06, otro: 0.05 };

/**
 * Gramos recomendados de un alimento para la comida elegida, según su rol en el plato
 * y lo que queda de presupuesto en esa comida y en el día.
 */
export function recommendGrams(food, meal, targets, state) {
  if (!targets?.ok || !food.k) return { grams: null, why: "" };
  const per = food.k / 100;
  const mealTarget = targets.meals[meal] || targets.meals.extra;
  const mealLeft = Math.max(0, mealTarget - (state.byMeal[meal]?.kcal || 0));
  const dayLeft = Math.max(0, targets.kcal - state.tot.kcal);
  const isTreat = (food.fl || []).includes("antojo") || food.role === "dulce";
  let kcalBudget, why;
  if (food.role === "plato") {
    kcalBudget = Math.min(mealLeft, dayLeft);
    why = `para cubrir lo que queda de ${MEAL_PHRASE[meal]} (${Math.round(mealLeft)} kcal)`;
  } else if (isTreat) {
    const treatLeft = Math.max(0, targets.extra - state.tot.antojo);
    kcalBudget = Math.min(treatLeft, dayLeft);
    why = `según tu margen de antojos de hoy (${Math.round(treatLeft)} kcal)`;
  } else if (food.role === "verdura") {
    return { grams: 150, why: "las verduras son casi libres: de 100 a 200 g por comida es ideal" };
  } else {
    const share = ROLE_SHARE[food.role] ?? 0.1;
    kcalBudget = Math.min(mealTarget * share, mealLeft, dayLeft);
    why = `${Math.round(share * 100)} % de ${MEAL_PHRASE[meal]}, como ${(ROLE_LABEL[food.role] || "alimento").toLowerCase()}`;
  }
  if (kcalBudget <= 0) return { grams: 0, why: "ya cubriste tu presupuesto de esta comida o del día" };
  let grams = round5(kcalBudget / per);
  const cap = food.role === "plato" ? (food.portion || 400) * 1.2 : food.role === "bebida" || food.role === "lacteo" ? 400 : 350;
  grams = Math.min(grams, cap);
  return { grams, why };
}

// ------------------------------------------------------- evaluación por horario

/**
 * Evalúa si conviene comer este alimento a esta hora (hora de Colombia) y con el presupuesto restante.
 * Devuelve nivel ("ok" | "aviso" | "no"), mensajes y alternativas.
 */
export function evaluate(food, grams, minutes, settings, targets, state) {
  const msgs = [];
  let level = "ok";
  const p = portion(food, grams);
  const wake = toMin(settings.wake), sleep = toMin(settings.sleep);
  const heavyCut = sleep - 120, lightCut = sleep - 60;
  const night = minutes >= heavyCut || minutes < wake - 30;
  const lateNight = minutes >= lightCut || minutes < wake - 30;
  const fl = food.fl || [];

  if (night) {
    const reasons = [];
    if (fl.includes("carne_roja")) reasons.push("la carne roja tarda 3-4 horas en digerirse y a esta hora empeora la calidad del sueño y favorece el reflujo");
    else if (fl.includes("frito")) reasons.push("los fritos son pesados para la noche y dificultan el descanso");
    else if (fl.includes("pesado")) reasons.push("es un alimento pesado y con mucha grasa para esta hora");
    if (fl.includes("azucar") || (fl.includes("antojo") && (food.c || 0) > 30)) reasons.push("el azúcar de noche dispara la glucosa y suele aumentar el hambre al día siguiente");
    if (fl.includes("alcohol")) reasons.push("el alcohol nocturno fragmenta el sueño y suma calorías vacías");
    if (p.kcal > 350) reasons.push(`la porción (${p.kcal} kcal) es grande para lo cerca que estás de dormir`);
    if (reasons.length) {
      level = fl.includes("carne_roja") || fl.includes("frito") || p.kcal > 500 ? "no" : "aviso";
      msgs.push(`${level === "no" ? "No te lo recomiendo" : "Mejor evítalo"} a las ${fromMin(minutes)}: ${reasons.join("; ")}.`);
    } else if (lateNight && p.kcal > 200) {
      level = "aviso";
      msgs.push(`Ya es tarde (${fromMin(minutes)}). Si tienes hambre, una porción más pequeña es mejor para dormir bien.`);
    }
  }

  if (targets?.ok) {
    const dayLeft = targets.kcal - state.tot.kcal;
    if (p.kcal > dayLeft) {
      if (level === "ok") level = "aviso";
      msgs.push(dayLeft > 0 ? `Esta porción (${p.kcal} kcal) supera lo que te queda hoy (${Math.round(dayLeft)} kcal).`
        : `Ya alcanzaste tu meta de hoy (${targets.kcal} kcal). No pasa nada por un día, pero intenta compensar con algo ligero.`);
    }
    if (fl.includes("antojo")) {
      const treatLeft = targets.extra - state.tot.antojo;
      if (p.kcal > treatLeft) {
        if (level === "ok") level = "aviso";
        msgs.push(treatLeft > 0 ? `Tu margen de antojos de hoy es ${Math.round(treatLeft)} kcal; con ${grams} g lo superas.`
          : "Ya usaste tu margen de antojos de hoy. Si te provoca, que sea una porción pequeña.");
      } else {
        msgs.push(`Entra en tu margen de antojos de hoy (te quedan ${Math.round(treatLeft - p.kcal)} kcal después de esto). ¡Disfrútalo sin culpa!`);
      }
    }
  }

  let alternatives = [];
  if (level !== "ok") alternatives = lightOptions(night ? FOODS.night_light : FOODS.cravings.hambre, targets, state, night, food.id);
  return { level, msgs, kcal: p.kcal, alternatives, night };
}

function resolveRefs(refs) {
  return refs.map((r) => ({ food: FOODS.byId.get(r.id), grams: r.grams })).filter((x) => x.food);
}

/** Opciones ligeras que caben en el presupuesto, ordenadas por saciedad (proteína/fibra por kcal). */
export function lightOptions(refs, targets, state, night, excludeId) {
  const left = targets?.ok ? Math.max(0, targets.kcal - state.tot.kcal) : Infinity;
  return resolveRefs(refs)
    .filter((x) => x.food.id !== excludeId && !(night && (x.food.fl || []).includes("pesado")))
    .map((x) => ({ ...x, ...portion(x.food, x.grams) }))
    .filter((x) => x.kcal <= Math.max(left, 120))
    .sort((a, b) => (b.prot + b.fiber * 2) / Math.max(b.kcal, 1) - (a.prot + a.fiber * 2) / Math.max(a.kcal, 1))
    .slice(0, 4);
}

/** Asistente de antojos: opciones según el tipo de antojo, la hora y el margen del día. */
export function cravingOptions(type, minutes, settings, targets, state) {
  const night = minutes >= toMin(settings.sleep) - 120 || minutes < toMin(settings.wake) - 30;
  const list = resolveRefs(FOODS.cravings[type] || []).map((x) => ({ ...x, ...portion(x.food, x.grams) }));
  const dayLeft = targets?.ok ? targets.kcal - state.tot.kcal : Infinity;
  const treatLeft = targets?.ok ? targets.extra - state.tot.antojo : Infinity;
  return list.map((x) => {
    const treat = (x.food.fl || []).includes("antojo");
    const fits = x.kcal <= Math.max(0, treat ? Math.min(treatLeft, dayLeft) : dayLeft) || x.kcal <= 60;
    const bad = night && (x.food.fl || []).some((f) => ["pesado", "carne_roja", "frito", "alcohol"].includes(f));
    return { ...x, treat, fits: fits && !bad, note: bad ? "no ideal a esta hora" : !fits ? "supera tu margen de hoy" : treat ? "cuenta como antojo" : "opción ligera" };
  }).sort((a, b) => Number(b.fits) - Number(a.fits) || a.kcal - b.kcal);
}

/** Sugerencias de comidas colombianas ajustadas a la meta de la comida. */
export function suggestMeals(meal, targets, state, minutes, settings) {
  if (!targets?.ok) return [];
  const goal = Math.max(150, (targets.meals[meal] || 0) - (state.byMeal[meal]?.kcal || 0));
  const late = meal === "comida" && minutes != null && minutes >= toMin(settings.sleep) - 180;
  return (FOODS.meal_templates[meal] || [])
    .map((id) => FOODS.byId.get(id))
    .filter((f) => f && !(meal === "comida" && (f.fl || []).includes("pesado")) && !(late && (f.fl || []).includes("pesado")))
    .map((f) => {
      const base = f.portion || 300;
      const kcalBase = (f.k * base) / 100;
      const factor = Math.min(1.4, Math.max(0.6, goal / kcalBase));
      const grams = round5(base * factor);
      const p = portion(f, grams);
      const ings = (f.ing || []).filter(([c]) => c !== "AGUA").map(([c, g]) => ({ food: FOODS.byId.get(c), grams: round5(g * factor) })).filter((x) => x.food);
      return { food: f, grams, ...p, diff: Math.abs(p.kcal - goal), ings, occasional: (f.fl || []).includes("pesado") };
    })
    .sort((a, b) => Number(a.occasional) - Number(b.occasional) || a.diff - b.diff)
    .slice(0, 4);
}

// --------------------------------------------- gasto adaptativo y peso esperado

function slope(points) {
  if (points.length < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den ? num / den : null;
}
const dayNum = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/**
 * Estima tu gasto real con los últimos 28 días: ingesta media + (pérdida de peso × 7700).
 * Necesita al menos 14 días registrados (≥ 800 kcal) y 2 pesajes separados ≥ 14 días.
 */
export function adaptiveEstimate(energy, targetsNoAdapt) {
  const end = dayNum(energy.to);
  const days = Object.entries(energy.intake).filter(([d, v]) => end - dayNum(d) < 28 && v.kcal >= 800);
  const ws = energy.weights.filter((w) => end - dayNum(w.date) < 28 && end - dayNum(w.date) >= 0);
  const span = ws.length >= 2 ? dayNum(ws[ws.length - 1].date) - dayNum(ws[0].date) : 0;
  const info = { ready: false, daysLogged: days.length, weighIns: ws.length, span };
  if (days.length < 14 || ws.length < 2 || span < 14 || !targetsNoAdapt?.ok) return info;
  const avgIntake = days.reduce((a, [, v]) => a + v.kcal, 0) / days.length;
  const s = slope(ws.map((w) => ({ x: dayNum(w.date), y: w.weight_kg })));
  const exDays = Object.entries(energy.exercise).filter(([d]) => end - dayNum(d) < 28);
  const avgExercise = exDays.reduce((a, [, v]) => a + v.kcal, 0) / 28;
  const observed = avgIntake - s * 7700;
  const formula = targetsNoAdapt.formulaBase + avgExercise;
  const factor = Math.min(1.15, Math.max(0.85, observed / formula));
  return { ...info, ready: true, avgIntake: Math.round(avgIntake), observed: Math.round(observed), formula: Math.round(formula),
    factor: Math.round(factor * 1000) / 1000, kgPerWeek: r1(s * 7) };
}

/**
 * Peso esperado según el balance energético registrado vs. peso real.
 * Solo cuenta los días con comidas registradas (≥ 800 kcal); el resto se marca como sin datos.
 */
export function expectedWeight(energy, baseKcal, startDate, startWeight) {
  const start = dayNum(startDate), end = dayNum(energy.to);
  let w = startWeight, logged = 0, total = 0;
  const series = [{ x: startDate, y: r1(w) }];
  let cumDeficit = 0;
  for (let d = start; d <= end; d++) {
    total++;
    const iso = new Date(d * 86400000).toISOString().slice(0, 10);
    const intake = energy.intake[iso];
    if (intake && intake.kcal >= 800) {
      logged++;
      const ex = energy.exercise[iso]?.kcal || 0;
      cumDeficit += baseKcal + ex - intake.kcal;
      w = startWeight - cumDeficit / 7700;
    }
    if ((d - start) % 7 === 6 || d === end) series.push({ x: iso, y: r1(w) });
  }
  return { series, coverage: total ? logged / total : 0, logged, total, deficitKg: r1(cumDeficit / 7700) };
}
