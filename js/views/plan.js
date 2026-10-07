import { api, store, refreshProfile } from "../api.js";
import { esc, fmt, toast, todayISO, parseISO, addDays, confirmDialog, ICON } from "../util.js";
import { guard } from "../app.js";

const ACTIVITY = {
  sedentario: "Sedentario (trabajo sentado, poco movimiento)",
  ligero: "Ligero (caminas algo a diario)",
  moderado: "Moderado (trabajo de pie / activo)",
  activo: "Activo (trabajo físico)",
  muy_activo: "Muy activo (trabajo físico intenso)",
};
const GOALS = { perdida_grasa: "Pérdida de grasa", recomposicion: "Recomposición corporal", fuerza: "Ganar fuerza", salud: "Salud y hábito" };
const EQ_PRESETS = {
  gimnasio: null, // todo el equipamiento
  casa: ["body weight", "dumbbell", "band", "resistance band", "stability ball", "kettlebell", "medicine ball", "rope"],
  corporal: ["body weight"],
};

let editingPlanId = null; // null = plan activo, "new" = nuevo plan

export async function render(el, r) {
  const [profile, plans, routines] = await Promise.all([api.get("/api/profile"), api.get("/api/plans"), api.get("/api/routines")]);
  store.profile = profile;
  const configured = !!profile.height_cm;
  const active = plans.find((p) => p.active);
  if (editingPlanId !== "new" && editingPlanId != null && !plans.some((p) => p.id === editingPlanId)) editingPlanId = null;
  const plan = editingPlanId === "new" ? null : plans.find((p) => p.id === editingPlanId) || active || null;
  const isNew = !plan;
  const m = profile.metrics;
  const weight = profile.current_weight || profile.weight_kg;
  const welcome = !configured || r.query.bienvenida;

  el.innerHTML = `
    <div class="page-head"><div><h1>Plan y perfil</h1><p>Tus datos, tus objetivos y tu calendario. Todo es editable cuando quieras.</p></div></div>
    ${welcome ? `<div class="card callout accent" style="margin-bottom:16px">
      <h2 style="margin-bottom:6px">Bienvenido a FitPlan</h2>
      <p>Configúralo en 3 pasos: <b>1)</b> completa tu perfil, <b>2)</b> crea tu plan (30, 60, 90 días o lo que necesites) y
      <b>3)</b> genera tus rutinas y calendario automáticamente. Después podrás ajustar cada ejercicio a tu gusto.</p></div>` : ""}

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2">
        <div class="card-head"><h2>1 · Perfil</h2></div>
        <form id="pForm">
          <div class="form-grid">
            <label class="field">Nombre<input name="name" maxlength="60" value="${esc(profile.name)}"></label>
            <label class="field">Sexo <span class="hint">Para el metabolismo basal</span>
              <select name="sex"><option value="">Prefiero no indicarlo</option>
                <option value="masculino" ${profile.sex === "masculino" ? "selected" : ""}>Masculino</option>
                <option value="femenino" ${profile.sex === "femenino" ? "selected" : ""}>Femenino</option></select></label>
            <label class="field">Edad<input name="age" type="number" min="14" max="100" value="${profile.age ?? ""}"></label>
            <label class="field">Altura (cm)<input name="height_cm" type="number" min="120" max="230" step="0.5" required value="${profile.height_cm ?? 187}"></label>
            <label class="field">Peso actual (kg)<input name="weight_kg" type="number" min="30" max="350" step="0.1" required value="${weight ?? 120}"></label>
            <label class="field">Actividad diaria (sin contar entrenos)
              <select name="activity">${Object.entries(ACTIVITY).map(([k, v]) => `<option value="${k}" ${profile.activity === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
            <label class="field">Nivel de entrenamiento
              <select name="level">
                <option value="principiante" ${profile.level === "principiante" ? "selected" : ""}>Principiante (&lt; 6 meses)</option>
                <option value="intermedio" ${profile.level === "intermedio" ? "selected" : ""}>Intermedio (6 meses - 2 años)</option>
                <option value="avanzado" ${profile.level === "avanzado" ? "selected" : ""}>Avanzado (&gt; 2 años)</option></select></label>
          </div>
          <label class="check" style="margin-top:12px"><input type="checkbox" name="low_impact" ${profile.low_impact ? "checked" : ""}>
            <span>Priorizar ejercicios de <b>bajo impacto</b> (recomendado con IMC ≥ 30 o molestias en rodillas, tobillos o espalda)</span></label>
          <div style="margin-top:16px">
            <div class="row between" style="margin-bottom:8px"><b>Equipamiento disponible</b>
              <div class="row"><span class="small muted">Atajos:</span>
                <button type="button" class="btn sm" data-preset="gimnasio">Gimnasio completo</button>
                <button type="button" class="btn sm" data-preset="casa">Casa</button>
                <button type="button" class="btn sm" data-preset="corporal">Solo peso corporal</button></div></div>
            <div class="check-grid">${store.meta.equipment.map((e) => `<label class="check small">
              <input type="checkbox" name="eq" value="${e.key}" ${!profile.equipment.length || profile.equipment.includes(e.key) ? "checked" : ""}> ${esc(e.label)}</label>`).join("")}</div>
          </div>
          <div class="row" style="margin-top:16px"><button class="btn primary" type="submit">${ICON.check}Guardar perfil</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>Tus métricas</h2></div>
        ${configured ? `
        <div class="kv" style="grid-template-columns:1fr 1fr">
          <div><div class="k">IMC</div><div class="v">${fmt.dec(m.bmi)}</div></div>
          <div><div class="k">Clasificación OMS</div><div class="v" style="font-size:13.5px">${esc(m.bmi_class)}</div></div>
          <div><div class="k">Peso saludable</div><div class="v" style="font-size:13.5px">${fmt.dec(m.healthy_min)}–${fmt.dec(m.healthy_max)} kg</div></div>
          <div><div class="k">Metabolismo basal</div><div class="v">${m.bmr ? fmt.int(m.bmr) + " kcal" : "–"}</div></div>
          <div style="grid-column:span 2"><div class="k">Gasto diario sin ejercicio (GET)</div><div class="v">${m.tdee ? fmt.int(m.tdee) + " kcal/día" : "Indica sexo y edad"}</div></div>
        </div>
        <p class="small muted" style="margin-top:10px">IMC = peso / altura². Metabolismo basal: ecuación de Mifflin-St Jeor. El IMC no distingue músculo de grasa:
        complementa con la medida de cintura en <a href="#/progreso">Progreso</a>.</p>
        ${m.bmi >= 30 ? `<div class="callout" style="margin-top:10px">Con IMC ≥ 30, la estrategia más segura y eficaz es combinar <b>fuerza con cargas
        progresivas</b> (protege tu masa muscular) con <b>cardio de bajo impacto</b> y caminar a diario. Si tienes alguna condición médica, consulta antes con tu médico.</div>` : ""}`
        : `<p class="muted">Guarda tu perfil para ver IMC, metabolismo basal y gasto diario.</p>`}
      </div>
    </div>

    <div class="grid cols-3" style="margin-bottom:16px" ${configured ? "" : "hidden"}>
      <div class="card span-2">
        <div class="card-head"><div><h2>2 · ${isNew ? "Nuevo plan" : "Plan: " + esc(plan.name)}</h2>
          <div class="sub">${isNew ? "Define la duración y los objetivos." : plan.active ? "Plan activo" : "Plan inactivo"}</div></div>
          ${!isNew ? `<button class="btn sm" id="newPlan">${ICON.plus}Nuevo plan</button>` : ""}</div>
        <form id="planForm">
          <div class="form-grid">
            <label class="field">Nombre<input name="name" required maxlength="80" value="${esc(plan?.name ?? "Plan 60 días")}"></label>
            <label class="field">Objetivo<select name="goal">${Object.entries(GOALS).map(([k, v]) => `<option value="${k}" ${(plan?.goal ?? "perdida_grasa") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
            <label class="field">Fecha de inicio<input name="start_date" type="date" required value="${plan?.start_date ?? todayISO()}"></label>
            <label class="field">Duración (días)<input name="duration_days" type="number" min="7" max="730" required value="${plan?.duration_days ?? 60}"></label>
          </div>
          <div class="chips" style="margin-top:10px" id="durChips">
            ${[30, 60, 90, 120, 180].map((d) => `<button type="button" class="chip btn-chip" data-d="${d}">${d} días</button>`).join("")}
          </div>
          <div class="form-grid" style="margin-top:14px">
            <label class="field">Peso al inicio (kg)<input name="start_weight" type="number" step="0.1" min="30" max="350" value="${plan?.start_weight ?? weight ?? ""}"></label>
            <label class="field">Peso objetivo (kg)<input name="goal_weight" type="number" step="0.1" min="30" max="350" value="${plan?.goal_weight ?? suggestGoal(weight, 60)}"></label>
            <label class="field">Sesiones / semana<input name="sessions_per_week" type="number" min="1" max="7" required value="${plan?.sessions_per_week ?? 4}"></label>
            <label class="field">Minutos / sesión<input name="minutes_per_session" type="number" min="10" max="240" required value="${plan?.minutes_per_session ?? 50}"></label>
            <label class="field">Objetivo kcal / semana<input name="weekly_kcal_target" type="number" min="0" max="20000" required value="${plan?.weekly_kcal_target ?? ""}"></label>
            <label class="field">Objetivo minutos / semana<input name="weekly_minutes_target" type="number" min="0" max="3000" required value="${plan?.weekly_minutes_target ?? ""}"></label>
          </div>
          <div class="row" style="margin-top:10px"><button type="button" class="btn sm" id="suggest">${ICON.spark}Calcular objetivos semanales recomendados</button>
            <span class="small muted" id="suggestNote"></span></div>
          <label class="field" style="margin-top:12px">Notas<textarea name="notes" maxlength="2000" placeholder="Motivación, restricciones, recordatorios…">${esc(plan?.notes ?? "")}</textarea></label>
          <div class="row" style="margin-top:14px">
            <button class="btn primary" type="submit">${ICON.check}${isNew ? "Crear plan" : "Guardar plan"}</button>
            ${!isNew && !plan.active ? `<button type="button" class="btn" id="activate">Activar este plan</button>` : ""}
            ${editingPlanId === "new" && active ? `<button type="button" class="btn" id="cancelNew">Cancelar</button>` : ""}
            <span class="spacer"></span>
            ${!isNew ? `<button type="button" class="btn ghost danger" id="delPlan">${ICON.trash}Eliminar plan</button>` : ""}
          </div>
        </form>
      </div>
      <div class="card" id="guidance"></div>
    </div>

    <div class="card" style="margin-bottom:16px" ${!isNew && configured ? "" : "hidden"} id="schedCard">
      <div class="card-head"><div><h2>3 · Calendario semanal</h2>
        <div class="sub">Asigna una rutina a cada día. Los días sin rutina son de descanso o actividad libre.</div></div>
        <div class="row">
          <button class="btn" id="genAll">${ICON.spark}Generar rutinas y calendario</button>
          <button class="btn primary" id="saveSched">${ICON.check}Guardar calendario</button></div></div>
      <div class="day-sched">${store.meta.weekdays.map((d, i) => `
        <div class="day ${i === (parseISO(todayISO()).getDay() + 6) % 7 ? "today" : ""}"><b>${d}</b>
          <select data-wd="${i}" aria-label="Rutina del ${d}"><option value="">Descanso</option>
            ${routines.map((rt) => `<option value="${rt.id}" ${plan?.schedule?.[i] === rt.id ? "selected" : ""}>${esc(rt.name)}</option>`).join("")}</select></div>`).join("")}
      </div>
      ${!routines.length ? `<p class="small muted" style="margin-top:10px">Aún no tienes rutinas: pulsa <b>Generar rutinas y calendario</b> o créalas en <a href="#/rutinas">Rutinas</a>.</p>` : ""}
    </div>

    <div class="grid cols-2">
      <div class="card" ${plans.length ? "" : "hidden"}>
        <div class="card-head"><h2>Historial de planes</h2></div>
        ${plans.map((p) => `<div class="list-item">
          <div style="flex:1;min-width:0"><div class="row"><b>${esc(p.name)}</b>${p.active ? `<span class="status good">Activo</span>` : ""}</div>
            <div class="small muted">${fmt.date(p.start_date)} → ${fmt.date(p.guidance.end_date)} · ${p.duration_days} días · ${esc(GOALS[p.goal] || p.goal)}</div></div>
          <button class="btn sm" data-edit="${p.id}">${ICON.edit}Ver / editar</button></div>`).join("")}
      </div>
      <div class="card">
        <div class="card-head"><h2>Tus datos</h2></div>
        ${store.mode === "local"
          ? `<p class="small muted">Tus datos se guardan solo en este dispositivo. Exporta una copia de vez en cuando y guárdala en Archivos o iCloud Drive.
             El mismo archivo sirve para pasar tus datos entre el móvil y la versión de PC (Importar copia).</p>`
          : `<p class="small muted">Todo se guarda en local, en la carpeta <b>datos</b> del proyecto. Cada día que abres la app se crea una copia automática en <b>datos/copias_seguridad</b>.
             El archivo exportado también se puede importar en la versión móvil.</p>`}
        <div class="row" style="margin-top:12px">
          <button class="btn" id="export">Exportar copia (JSON)</button>
          <label class="btn" style="cursor:pointer">Importar copia<input type="file" id="import" accept="application/json,.json" hidden></label>
        </div>
        ${store.mode === "local" ? `
        <div style="margin-top:18px;border-top:1px solid var(--grid);padding-top:14px">
          <b>Uso sin conexión</b>
          <p class="small muted" style="margin-top:4px">La app ya funciona sin internet. Las imágenes y animaciones se guardan a medida que las ves; puedes descargarlas todas ahora (mejor con Wi-Fi).</p>
          <div class="row" style="margin-top:10px">
            <button class="btn sm" id="dlThumbs">Descargar miniaturas (8 MB)</button>
            <button class="btn sm" id="dlGifs">Descargar animaciones (123 MB)</button>
          </div>
          <p class="small muted" id="dlStatus" style="margin-top:8px"></p>
        </div>` : ""}
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  // ---------------- Perfil
  const pForm = $("#pForm");
  pForm.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const set = EQ_PRESETS[b.dataset.preset];
    pForm.querySelectorAll("input[name=eq]").forEach((c) => { c.checked = !set || set.includes(c.value); });
  }));
  pForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(pForm);
    const eq = f.getAll("eq");
    if (!eq.length) { toast("Selecciona al menos un tipo de equipamiento (p. ej. peso corporal).", "error"); return; }
    const all = eq.length === store.meta.equipment.length;
    try {
      await api.put("/api/profile", {
        name: f.get("name"), sex: f.get("sex"), age: f.get("age") || null, height_cm: f.get("height_cm"),
        weight_kg: f.get("weight_kg"), activity: f.get("activity"), level: f.get("level"),
        low_impact: f.get("low_impact") === "on", equipment: all ? [] : eq,
      });
      await refreshProfile();
      toast("Perfil guardado");
      render(el, { ...r, query: {} });
    } catch (err) { toast(err.message, "error"); }
  });

  if (!configured) return;

  // ---------------- Plan
  const planForm = $("#planForm");
  const fv = (n) => planForm.elements[n].value;
  const setv = (n, v) => { planForm.elements[n].value = v; };
  const markChips = () => $("#durChips").querySelectorAll("[data-d]").forEach((c) => c.classList.toggle("on", c.dataset.d === fv("duration_days")));
  markChips();
  planForm.addEventListener("input", (e) => { guard.dirty = true; if (e.target.name === "duration_days") markChips(); drawGuidance(); });
  $("#durChips").addEventListener("click", (e) => {
    const c = e.target.closest("[data-d]");
    if (!c) return;
    setv("duration_days", c.dataset.d);
    if (isNew) {
      setv("name", `Plan ${c.dataset.d} días`);
      setv("goal_weight", suggestGoal(Number(fv("start_weight")) || weight, Number(c.dataset.d)));
    }
    guard.dirty = true; markChips(); drawGuidance();
  });

  const suggestTargets = async (silent = false) => {
    try {
      const s = await api.post("/api/plans/suggest-kcal", { sessions_per_week: fv("sessions_per_week"), minutes_per_session: fv("minutes_per_session") });
      setv("weekly_kcal_target", s.weekly_kcal_target);
      setv("weekly_minutes_target", s.weekly_minutes_target);
      $("#suggestNote").textContent = `Basado en ${fv("sessions_per_week")} sesiones de ${fv("minutes_per_session")} min con intensidad mixta (≈4,5 MET) para ${fmt.kg(weight)}.`;
      drawGuidance();
    } catch (err) { if (!silent) toast(err.message, "error"); }
  };
  $("#suggest").addEventListener("click", () => { guard.dirty = true; suggestTargets(); });
  if (isNew && !fv("weekly_kcal_target")) suggestTargets(true);

  function drawGuidance() {
    const g = $("#guidance");
    const days = Number(fv("duration_days")), sw = Number(fv("start_weight")), gw = Number(fv("goal_weight"));
    const kcal = Number(fv("weekly_kcal_target")) || 0;
    const start = fv("start_date");
    if (!(days >= 7) || !start) { g.innerHTML = `<h2>Análisis del plan</h2><p class="muted" style="margin-top:8px">Completa fecha y duración.</p>`; return; }
    const end = addDays(start, days - 1);
    const weeks = days / 7;
    const ref = weight || sw;
    let feas = "", rate = null;
    if (sw && gw && sw > gw) {
      rate = (sw - gw) / weeks;
      const safeMax = ref * 0.01, safeMin = ref * 0.005;
      const lvl = rate <= safeMax ? ["good", "Ritmo realista y saludable"] : rate <= safeMax * 1.3 ? ["warning", "Ritmo exigente"] : ["critical", "Ritmo demasiado agresivo"];
      feas = `<p style="margin-top:10px"><span class="status ${lvl[0]}">${lvl[1]}</span></p>
        <p class="small ink-2" style="margin-top:6px">Necesitas perder <b>${fmt.dec(rate)} kg/semana</b>. Rango recomendado para ti:
        <b>${fmt.dec(safeMin)}–${fmt.dec(safeMax)} kg/semana</b> (0,5-1 % de tu peso), lo que protege la masa muscular.</p>`;
    }
    const exKg = kcal / 7700;
    const dailyDeficitNeeded = rate ? (rate * 7700) / 7 : null;
    const exDaily = kcal / 7;
    g.innerHTML = `
      <h2>Análisis del plan</h2>
      <div class="kv" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <div><div class="k">Termina el</div><div class="v" style="font-size:14px">${fmt.date(end)}</div></div>
        <div><div class="k">Semanas</div><div class="v">${fmt.dec(weeks)}</div></div>
        <div><div class="k">Ejercicio / semana</div><div class="v">${fmt.int(kcal)} kcal</div></div>
        <div><div class="k">≈ grasa / semana</div><div class="v">${fmt.dec(exKg)} kg</div></div>
      </div>
      ${feas}
      ${dailyDeficitNeeded ? `<div class="callout" style="margin-top:12px">Para ese ritmo hace falta un déficit de ~<b>${fmt.int(dailyDeficitNeeded)} kcal/día</b>.
        El ejercicio aporta ~<b>${fmt.int(exDaily)} kcal/día</b>; el resto (~${fmt.int(Math.max(0, dailyDeficitNeeded - exDaily))} kcal/día) deberá venir de la alimentación
        — lo cubriremos en la futura app de nutrición.</div>` : ""}
      <p class="small muted" style="margin-top:10px">Fases: adaptación (25 %), progresión (50 %) y consolidación (25 %). La app te indicará en cada momento cómo ajustar intensidad.</p>`;
  }
  drawGuidance();

  planForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(planForm);
    const body = Object.fromEntries(f.entries());
    if (body.start_weight && body.goal_weight && Number(body.goal_weight) > Number(body.start_weight) && body.goal === "perdida_grasa") {
      toast("Para pérdida de grasa, el peso objetivo debe ser menor que el inicial.", "error"); return;
    }
    if (!isNew) body.schedule = readSchedule();
    try {
      const saved = isNew ? await api.post("/api/plans", body) : await api.put(`/api/plans/${plan.id}`, body);
      guard.dirty = false;
      editingPlanId = saved.id;
      toast(isNew ? "Plan creado. Ahora genera tus rutinas y calendario." : "Plan guardado");
      render(el, { ...r, query: {} });
    } catch (err) { toast(err.message, "error"); }
  });
  $("#newPlan")?.addEventListener("click", () => { editingPlanId = "new"; guard.dirty = false; render(el, r); });
  $("#cancelNew")?.addEventListener("click", () => { editingPlanId = null; guard.dirty = false; render(el, r); });
  $("#activate")?.addEventListener("click", async () => {
    try { await api.post(`/api/plans/${plan.id}/activate`); toast("Plan activado"); render(el, r); } catch (err) { toast(err.message, "error"); }
  });
  $("#delPlan")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`¿Eliminar el plan «${plan.name}»? Las sesiones registradas y las rutinas se conservan.`, { ok: "Eliminar", danger: true }))) return;
    try { await api.del(`/api/plans/${plan.id}`); editingPlanId = null; guard.dirty = false; toast("Plan eliminado"); render(el, r); }
    catch (err) { toast(err.message, "error"); }
  });
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    editingPlanId = Number(b.dataset.edit); guard.dirty = false; render(el, r); window.scrollTo(0, 0);
  }));

  // ---------------- Calendario
  function readSchedule() {
    const s = {};
    el.querySelectorAll("[data-wd]").forEach((sel) => { if (sel.value) s[sel.dataset.wd] = Number(sel.value); });
    return s;
  }
  el.querySelectorAll("[data-wd]").forEach((s) => s.addEventListener("change", () => { guard.dirty = true; }));
  $("#saveSched")?.addEventListener("click", async () => {
    if (isNew) return;
    try {
      const body = { ...pickPlan(plan), schedule: readSchedule() };
      await api.put(`/api/plans/${plan.id}`, body);
      guard.dirty = false;
      toast("Calendario guardado");
    } catch (err) { toast(err.message, "error"); }
  });
  $("#genAll")?.addEventListener("click", async () => {
    if (isNew) return;
    const ok = await confirmDialog(`Se crearán rutinas nuevas adaptadas a tu perfil para ${plan.sessions_per_week} sesiones/semana de ${plan.minutes_per_session} min, y se reemplazará el calendario actual. Tus rutinas existentes no se borran.`, { ok: "Generar" });
    if (!ok) return;
    try {
      await api.post(`/api/plans/${plan.id}/generate`);
      guard.dirty = false;
      toast("Rutinas y calendario generados");
      render(el, r);
    } catch (err) { toast(err.message, "error"); }
  });

  // ---------------- Copias de seguridad
  $("#export").addEventListener("click", async () => {
    try {
      const data = await api.get("/api/backup");
      const name = `fitplan_copia_${todayISO()}.json`;
      const json = JSON.stringify(data, null, 1);
      // En iPhone, la hoja de compartir permite guardar en Archivos / iCloud Drive.
      const file = typeof File === "function" ? new File([json], name, { type: "application/json" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Copia de FitPlan" }); toast("Copia exportada"); return; }
        catch (e) { if (e?.name === "AbortError") return; }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Copia exportada");
    } catch (err) { toast(err.message, "error"); }
  });

  // Descarga masiva de media para uso sin conexión (las respuestas las guarda el service worker).
  const download = async (kind) => {
    const urls = store.exercises.map((e) => (kind === "gif" ? e.gif : e.image));
    const status = $("#dlStatus");
    $("#dlThumbs").disabled = $("#dlGifs").disabled = true;
    let done = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try { const r = await fetch(u); if (!r.ok) failed++; } catch { failed++; }
        done++;
        if (done % 20 === 0 || done === urls.length) status.textContent = `Descargando… ${done} / ${urls.length}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    status.textContent = failed ? `Completado con ${failed} errores (vuelve a intentarlo con buena conexión).` : `Listo: ${urls.length} archivos disponibles sin conexión.`;
    $("#dlThumbs").disabled = $("#dlGifs").disabled = false;
  };
  $("#dlThumbs")?.addEventListener("click", () => download("img"));
  $("#dlGifs")?.addEventListener("click", () => download("gif"));
  $("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast("El archivo no es un JSON válido.", "error"); return; }
    if (!(await confirmDialog("Se reemplazarán TODOS tus datos actuales por los de la copia (antes se guarda una copia de seguridad automática). ¿Continuar?", { ok: "Restaurar", danger: true }))) return;
    try {
      await api.post("/api/restore", data);
      toast("Copia restaurada");
      setTimeout(() => location.reload(), 600);
    } catch (err) { toast(err.message, "error"); }
  });
}

function suggestGoal(w, days) {
  if (!w) return "";
  // 0,75 % del peso por semana: punto medio del rango saludable (0,5-1 %).
  return Math.round((w - w * 0.0075 * (days / 7)) * 2) / 2;
}

function pickPlan(p) {
  const keys = ["name", "goal", "start_date", "duration_days", "start_weight", "goal_weight", "sessions_per_week",
    "minutes_per_session", "weekly_kcal_target", "weekly_minutes_target", "notes"];
  return Object.fromEntries(keys.map((k) => [k, p[k]]));
}
