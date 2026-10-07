import { api } from "../api.js";
import { esc, fmt, toast, todayISO, addDays, weekStartISO, parseISO, ICON } from "../util.js";
import { barChart, multiLineChart } from "../charts.js";
import * as N from "../nutri.js";
import { loadNutritionContext } from "../nutrictx.js";
import { statTile } from "../components.js";
import { navigate } from "../app.js";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export async function render(el, r) {
  const mode = r.query.vista === "mes" ? "mes" : "semana";
  const today = todayISO();
  const ref = r.query.ref || today;
  let start, end, title;
  if (mode === "semana") {
    start = weekStartISO(ref); end = addDays(start, 6);
    title = `${fmt.dayMonth(start)} – ${fmt.dayMonth(end)}`;
  } else {
    const d = parseISO(ref);
    start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    end = `${start.slice(0, 8)}${String(last).padStart(2, "0")}`;
    title = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  const [ctx, period] = await Promise.all([loadNutritionContext(), api.get(`/api/energy?from=${start}&to=${end}`)]);
  const t = ctx.targets;
  const isCurrent = today >= start && today <= end;

  // Datos por día del periodo.
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const rows = days.map((d) => {
    const i = period.intake[d], ex = period.exercise[d];
    return { date: d, kcal: i ? Math.round(i.kcal) : 0, prot: i ? i.prot : 0, items: i?.items || 0,
      exercise: ex ? Math.round(ex.kcal) : 0, future: d > today };
  });
  const logged = rows.filter((x) => x.kcal >= 800);
  const totalKcal = rows.reduce((a, x) => a + x.kcal, 0);
  const totalEx = rows.reduce((a, x) => a + x.exercise, 0);
  const avg = logged.length ? Math.round(logged.reduce((a, x) => a + x.kcal, 0) / logged.length) : 0;
  const onTarget = t.ok ? logged.filter((x) => Math.abs(x.kcal - t.kcal) <= t.kcal * 0.1 || x.kcal < t.kcal).length : 0;
  const deficit = t.ok ? logged.reduce((a, x) => a + (t.base + x.exercise - x.kcal), 0) : 0;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Historial de nutrición</h1><p>Calorías consumidas, ejercicio y el peso que deberías estar perdiendo.</p></div>
      <div class="row">
        <div class="seg" id="mode"><button data-m="semana" class="${mode === "semana" ? "on" : ""}">Semana</button><button data-m="mes" class="${mode === "mes" ? "on" : ""}">Mes</button></div>
        <div class="week-nav">
          <button class="btn icon" id="prev" aria-label="Anterior">${ICON.left}</button>
          <span class="label" ${mode === "mes" ? `style="text-transform:capitalize"` : ""}>${esc(title)}</span>
          <button class="btn icon" id="next" aria-label="Siguiente" ${isCurrent ? "disabled" : ""}>${ICON.right}</button>
        </div>
      </div>
    </div>

    <div class="grid cols-4" style="margin-bottom:16px">
      ${statTile({ label: `Consumido en ${mode === "semana" ? "la semana" : "el mes"}`, value: fmt.int(totalKcal), unit: "kcal", foot: `${logged.length} de ${rows.filter((x) => !x.future).length} días registrados` })}
      ${statTile({ label: "Promedio diario", value: logged.length ? fmt.int(avg) : "–", unit: "kcal", target: t.ok && logged.length ? t.kcal : null, current: avg, meterClass: "kcal",
        foot: `${t.ok ? `Meta actual: ${fmt.int(t.kcal)} kcal. ` : ""}Solo cuenta días completos (≥ 800 kcal registradas).` })}
      ${statTile({ label: "Días dentro de la meta", value: `${onTarget}`, unit: `/ ${logged.length}`, foot: "Días registrados en o por debajo de la meta (+10 %)" })}
      ${statTile({ label: "Déficit acumulado", value: fmt.int(deficit), unit: "kcal", foot: `≈ <b>${fmt.dec(deficit / 7700)} kg</b> de grasa (solo días registrados) · ejercicio ${fmt.int(totalEx)} kcal` })}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>Calorías por día</h2><div class="sub">Línea discontinua: tu meta diaria actual</div></div></div>
      <div id="dayChart"></div>
    </div>

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Peso esperado vs. real</h2><div class="sub" id="expSub"></div></div></div>
        <div id="expChart"></div>
      </div>
      <div class="card" id="adaptCard"></div>
    </div>

    <div class="card" id="settingsCard"></div>`;
  const $ = (s) => el.querySelector(s);

  $("#mode").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (b) navigate(`#/nutricion?vista=${b.dataset.m}&ref=${ref}`); });
  const shift = (dir) => {
    if (mode === "semana") return addDays(start, 7 * dir);
    const d = parseISO(start); d.setMonth(d.getMonth() + dir);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  $("#prev").addEventListener("click", () => navigate(`#/nutricion?vista=${mode}&ref=${shift(-1)}`));
  $("#next").addEventListener("click", () => navigate(`#/nutricion?vista=${mode}&ref=${shift(1)}`));

  barChart($("#dayChart"), rows.map((x) => ({
    label: mode === "semana" ? ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][(parseISO(x.date).getDay() + 6) % 7] : String(parseISO(x.date).getDate()),
    value: x.kcal, title: fmt.dateLong(x.date),
    rows: [["Consumido", `${fmt.int(x.kcal)} kcal`], ["Ejercicio", `${fmt.int(x.exercise)} kcal`], ["Proteína", `${fmt.int(x.prot)} g`], ["Registros", x.items]],
  })), { color: "var(--kcal)", target: t.ok ? t.kcal : null, targetLabel: "Meta", ariaLabel: "Calorías consumidas por día" });

  // ----- Peso esperado (balance energético) vs. peso real
  const plan = ctx.plan;
  if (plan && t.ok && plan.start_weight) {
    const fromDate = plan.start_date <= today ? plan.start_date : today;
    const energy = await api.get(`/api/energy?from=${fromDate}&to=${today}`);
    const exp = N.expectedWeight(energy, t.base, fromDate, plan.start_weight);
    const actual = energy.weights.filter((w) => w.date >= fromDate).map((w) => ({ x: w.date, y: w.weight_kg }));
    multiLineChart($("#expChart"), [
      { name: "Esperado por balance", color: "var(--kcal)", dashed: true, points: exp.series },
      { name: "Real (pesajes)", color: "var(--accent)", points: actual },
    ], { unit: "kg", decimals: true, ariaLabel: "Peso esperado frente a peso real", empty: "Registra comidas y pesos para ver la comparación." });
    const last = actual[actual.length - 1];
    const expLast = exp.series[exp.series.length - 1];
    $("#expSub").innerHTML = `Desde el inicio del plan (${fmt.date(fromDate)}): déficit registrado ≈ <b>${fmt.dec(exp.deficitKg)} kg</b>
      · ${Math.round(exp.coverage * 100)} % de días con comidas registradas${last ? ` · diferencia real vs. esperado: <b>${fmt.dec(last.y - expLast.y)} kg</b>` : ""}`;
  } else {
    $("#expChart").innerHTML = `<div class="chart-empty">Crea un plan con peso inicial y completa tu perfil para ver esta comparación.</div>`;
  }

  // ----- Gasto adaptativo
  const a = ctx.adaptive;
  $("#adaptCard").innerHTML = `
    <div class="card-head"><h2>Tu gasto real</h2></div>
    ${a.ready ? `
      <div class="kv" style="grid-template-columns:1fr 1fr">
        <div><div class="k">Según tus datos</div><div class="v">${fmt.int(a.observed)} kcal</div></div>
        <div><div class="k">Según fórmula</div><div class="v">${fmt.int(a.formula)} kcal</div></div>
        <div><div class="k">Ingesta media</div><div class="v">${fmt.int(a.avgIntake)} kcal</div></div>
        <div><div class="k">Tendencia peso</div><div class="v">${a.kgPerWeek > 0 ? "+" : ""}${fmt.dec(a.kgPerWeek)} kg/sem</div></div>
      </div>
      <p class="small ink-2" style="margin-top:10px">${ctx.useAdapt ? `Tus metas se ajustan automáticamente con un factor de <b>${String(a.factor).replace(".", ",")}</b>.`
        : ctx.settings.adaptive ? "Tu gasto real coincide con la fórmula: no hace falta ajustar." : "El ajuste automático está desactivado en los ajustes."}</p>`
      : `<p class="small ink-2">Para afinar tus metas con tu evolución real necesito, en las últimas 4 semanas:</p>
      <ul class="small ink-2" style="margin:8px 0 0;padding-left:18px">
        <li>Al menos 14 días con comidas registradas (llevas ${a.daysLogged}).</li>
        <li>Al menos 2 pesajes separados 14 días o más (llevas ${a.weighIns}${a.span ? `, ${a.span} días entre ellos` : ""}).</li></ul>
      <p class="small muted" style="margin-top:10px">Pésate una vez por semana, en ayunas y el mismo día. <a href="#/progreso">Registrar peso</a></p>`}`;

  // ----- Ajustes
  const st = ctx.settings;
  $("#settingsCard").innerHTML = `
    <div class="card-head"><div><h2>Ajustes de nutrición</h2><div class="sub">Horario en hora de Colombia, ritmo de pérdida y reparto de calorías</div></div></div>
    <form id="nsForm">
      <div class="form-grid">
        <label class="field">Me levanto<input name="wake" type="time" value="${st.wake}" required></label>
        <label class="field">Me acuesto<input name="sleep" type="time" value="${st.sleep}" required></label>
        <label class="field">Desayuno<input name="desayuno" type="time" value="${st.meals.desayuno}" required></label>
        <label class="field">Almuerzo<input name="almuerzo" type="time" value="${st.meals.almuerzo}" required></label>
        <label class="field">Comida<input name="comida" type="time" value="${st.meals.comida}" required></label>
      </div>
      <p class="small muted" style="margin-top:6px">Comidas pesadas hasta 2 h antes de acostarte (${N.fromMin(N.toMin(st.sleep) - 120)}); algo ligero hasta 1 h antes.</p>
      <div class="form-grid" style="margin-top:12px">
        <label class="field">% Desayuno<input name="s_desayuno" type="number" min="0" max="100" value="${st.split.desayuno}"></label>
        <label class="field">% Almuerzo<input name="s_almuerzo" type="number" min="0" max="100" value="${st.split.almuerzo}"></label>
        <label class="field">% Comida<input name="s_comida" type="number" min="0" max="100" value="${st.split.comida}"></label>
        <label class="field">% Antojos y extras<input name="s_extra" type="number" min="0" max="100" value="${st.split.extra}"></label>
      </div>
      <div class="form-grid" style="margin-top:12px">
        <label class="field">Ritmo de pérdida<select name="pace">${Object.entries(N.PACE).map(([k, v]) => `<option value="${k}" ${k === st.pace ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
        <label class="field">Proteína (g por kg de referencia)<input name="protein_g_per_kg" type="number" step="0.1" min="1" max="2.5" value="${st.protein_g_per_kg}"></label>
        <label class="field">Grasa (% de calorías)<input name="fat_pct" type="number" min="20" max="40" value="${st.fat_pct}"></label>
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="adaptive" ${st.adaptive ? "checked" : ""}> <span>Ajustar metas automáticamente según mi evolución real de peso (recomendado)</span></label>
      ${t.ok ? `<div class="callout small" style="margin-top:12px">
        Cálculo actual: metabolismo basal <b>${fmt.int(t.bmr)}</b> kcal → gasto sin ejercicio <b>${fmt.int(t.base)}</b> kcal${ctx.useAdapt ? " (ajustado)" : ""}.
        Déficit desde la comida <b>${fmt.int(t.foodDeficit)}</b> kcal/día + ejercicio previsto <b>${fmt.int(t.exerciseDay)}</b> kcal/día
        → pérdida esperada ≈ <b>${fmt.dec(t.expectedWeeklyLoss)} kg/semana</b>.
        ${t.floored ? "<br>Tu meta está en el mínimo seguro: no conviene comer menos." : ""}${t.goalReached ? "<br>Alcanzaste tu peso objetivo: metas de mantenimiento." : ""}</div>` : ""}
      <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">${ICON.check}Guardar ajustes</button></div>
    </form>`;
  $("#nsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      wake: f.get("wake"), sleep: f.get("sleep"),
      meals: { desayuno: f.get("desayuno"), almuerzo: f.get("almuerzo"), comida: f.get("comida") },
      split: { desayuno: Number(f.get("s_desayuno")), almuerzo: Number(f.get("s_almuerzo")), comida: Number(f.get("s_comida")), extra: Number(f.get("s_extra")) },
      pace: f.get("pace"), protein_g_per_kg: Number(f.get("protein_g_per_kg")), fat_pct: Number(f.get("fat_pct")), adaptive: f.get("adaptive") === "on",
    };
    try { await api.put("/api/nutrition/settings", body); toast("Ajustes guardados"); render(el, r); } catch (err) { toast(err.message, "error"); }
  });
}
