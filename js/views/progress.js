import { api, refreshProfile } from "../api.js";
import { esc, fmt, toast, todayISO, addDays, parseISO, confirmDialog, emptyState, ICON } from "../util.js";
import { lineChart, barChart } from "../charts.js";
import { statTile } from "../components.js";

/** Pendiente (kg/semana) por regresión lineal de los registros de los últimos `days` días. */
function weeklyTrend(weights, days = 28) {
  if (weights.length < 2) return null;
  const last = parseISO(weights[weights.length - 1].date).getTime();
  const pts = weights.filter((w) => last - parseISO(w.date).getTime() <= days * 86400000);
  if (pts.length < 2) return null;
  const xs = pts.map((w) => parseISO(w.date).getTime() / (7 * 86400000));
  const ys = pts.map((w) => w.weight_kg);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? num / den : null;
}

export async function render(el) {
  const [weights, plans, history, profile] = await Promise.all([
    api.get("/api/weights"), api.get("/api/plans"), api.get("/api/stats/history?weeks=26"), api.get("/api/profile"),
  ]);
  const plan = plans.find((p) => p.active);
  const first = weights[0], last = weights[weights.length - 1];
  const startW = plan?.start_weight ?? first?.weight_kg;
  const current = last?.weight_kg;
  const change = startW != null && current != null ? current - startW : null;
  const trend = weeklyTrend(weights);
  let projection = "Registra tu peso al menos una vez por semana para calcular la tendencia.";
  if (trend != null && plan?.goal_weight && current) {
    const remaining = current - plan.goal_weight;
    if (remaining <= 0) projection = "¡Objetivo de peso alcanzado!";
    else if (trend < -0.05) {
      const weeks = remaining / -trend;
      projection = `Al ritmo actual alcanzarías ${fmt.dec(plan.goal_weight)} kg hacia el ${fmt.date(addDays(todayISO(), Math.round(weeks * 7)))} (${fmt.int(weeks)} semanas).`;
    } else projection = "La tendencia de las últimas 4 semanas aún no es descendente. Revisa constancia y alimentación.";
  }
  const m = profile.metrics;

  el.innerHTML = `
    <div class="page-head"><div><h1>Progreso</h1><p>Evolución de tu peso corporal y de tu gasto por ejercicio.</p></div></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${statTile({ label: "Peso actual", value: fmt.dec(current), unit: "kg", foot: last ? `Último registro: ${fmt.date(last.date)}` : "Sin registros" })}
      ${statTile({ label: "Cambio total", value: change == null ? "–" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${fmt.dec(Math.abs(change))}`, unit: "kg",
        foot: change == null ? "" : change <= 0 ? `<span class="delta-good">Desde ${fmt.dec(startW)} kg</span>` : `<span class="delta-bad">Desde ${fmt.dec(startW)} kg</span>` })}
      ${statTile({ label: "Tendencia (4 semanas)", value: trend == null ? "–" : `${trend > 0 ? "+" : trend < 0 ? "−" : ""}${fmt.dec(Math.abs(trend))}`, unit: "kg/sem",
        foot: plan?.goal_weight ? `Objetivo: ${fmt.dec(plan.goal_weight)} kg` : "Define un peso objetivo en tu plan" })}
      ${statTile({ label: "IMC", value: fmt.dec(m.bmi), foot: m.healthy_min ? `${esc(m.bmi_class)} · rango saludable ${fmt.dec(m.healthy_min)}-${fmt.dec(m.healthy_max)} kg` : "" })}
    </div>

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Peso corporal</h2><div class="sub">${esc(projection)}</div></div></div>
        <div id="wChart"></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:12px">Registrar peso</h2>
        <form id="wForm" class="stack" style="gap:10px">
          <div class="row">
            <label class="field" style="flex:1">Fecha<input name="date" type="date" max="${todayISO()}" value="${todayISO()}" required></label>
            <label class="field" style="flex:1">Peso (kg)<input name="weight_kg" type="number" step="0.1" min="30" max="350" value="${current ?? ""}" required></label>
          </div>
          <label class="field">Cintura (cm) <span class="hint">Opcional, muy útil para ver pérdida de grasa</span><input name="waist_cm" type="number" step="0.5" min="40" max="250"></label>
          <label class="field">Nota<input name="note" maxlength="200"></label>
          <button class="btn primary" type="submit">${ICON.check}Guardar</button>
          <p class="small muted">Consejo: pésate en ayunas, el mismo día de la semana y a la misma hora. Un registro por día (si repites fecha, se actualiza).</p>
        </form>
      </div>
    </div>

    <div class="grid cols-3">
      <div class="card span-2">
        <div class="card-head"><div><h2>Calorías por ejercicio</h2><div class="sub">Últimas 26 semanas</div></div></div>
        <div id="kChart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Historial de peso</h2></div>
        <div class="table-wrap" style="max-height:340px;overflow:auto" id="wTable"></div>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  lineChart($("#wChart"), weights.map((w) => ({
    x: w.date, y: w.weight_kg,
    rows: [["Peso", fmt.kg(w.weight_kg)], ...(w.waist_cm ? [["Cintura", `${fmt.dec(w.waist_cm)} cm`]] : []), ...(w.note ? [["Nota", w.note]] : [])],
  })), { unit: "kg", decimals: true, goal: plan?.goal_weight ?? null, goalLabel: "Objetivo", color: "var(--accent)",
    empty: "Registra tu peso para ver la evolución.", ariaLabel: "Evolución del peso" });

  barChart($("#kChart"), history.map((h) => ({
    label: fmt.dayMonth(h.start), value: h.kcal, title: `Semana del ${fmt.date(h.start)}`,
    rows: [["Calorías", `${fmt.int(h.kcal)} kcal`], ["Minutos", fmt.int(h.minutes)], ["Sesiones", h.sessions]],
  })), { color: "var(--kcal)", target: plan?.weekly_kcal_target || null, ariaLabel: "Calorías por semana" });

  $("#wTable").innerHTML = weights.length ? `<table>
    <thead><tr><th>Fecha</th><th class="num">Peso</th><th class="num">Cintura</th><th></th></tr></thead>
    <tbody>${[...weights].reverse().map((w) => `<tr>
      <td>${fmt.date(w.date)}${w.note ? `<div class="small muted">${esc(w.note)}</div>` : ""}</td>
      <td class="num">${fmt.dec(w.weight_kg)}</td><td class="num">${w.waist_cm ? fmt.dec(w.waist_cm) : "–"}</td>
      <td style="width:40px"><button class="btn ghost icon danger" data-del="${w.date}" aria-label="Eliminar registro">${ICON.trash}</button></td></tr>`).join("")}
    </tbody></table>` : emptyState("Sin registros", "Añade tu primer peso.");

  $("#wForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api.post("/api/weights", {
        date: f.get("date"), weight_kg: Number(f.get("weight_kg")),
        waist_cm: f.get("waist_cm") ? Number(f.get("waist_cm")) : null, note: f.get("note"),
      });
      await refreshProfile();
      toast("Peso registrado");
      render(el);
    } catch (err) { toast(err.message, "error"); }
  });
  $("#wTable").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    if (!(await confirmDialog(`¿Eliminar el registro del ${fmt.date(b.dataset.del)}?`, { ok: "Eliminar", danger: true }))) return;
    try {
      await api.del(`/api/weights/${b.dataset.del}`);
      await refreshProfile();
      render(el);
    } catch (err) { toast(err.message, "error"); }
  });
}
