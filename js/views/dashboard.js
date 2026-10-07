import { api, store } from "../api.js";
import { esc, fmt, cap, ICON } from "../util.js";
import { barChart } from "../charts.js";
import { renderBodyMap } from "../bodymap.js";
import { statTile, prescriptionText } from "../components.js";
import { loadNutritionContext } from "../nutrictx.js";
import { daysBetween } from "../util.js";

export async function render(el) {
  const [d, nx, weights] = await Promise.all([
    api.get("/api/dashboard"),
    loadNutritionContext().catch(() => null),
    api.get("/api/weights"),
  ]);
  const { plan, guidance: g, week: w, metrics: mt } = d;
  const name = d.profile.name ? `, ${esc(d.profile.name)}` : "";
  const startW = plan?.start_weight;
  const lost = startW && d.weight ? startW - d.weight : null;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Hola${name}</h1><p>${cap(esc(fmt.dateLong(d.today)))}</p></div>
      ${g ? `<span class="phase-badge">${esc(g.phase.name)}</span>` : ""}
    </div>

    ${d.backup_reminder ? `<div class="callout" style="margin-bottom:16px">
        <span class="status warning">Copia de seguridad</span>
        ${d.backup_reminder.days == null ? "Aún no has exportado una copia de tus datos." : `Han pasado ${d.backup_reminder.days} días desde tu última copia.`}
        Tus datos solo están en este dispositivo: <a href="#/plan">exporta una copia</a> y guárdala en Archivos o iCloud Drive.</div>` : ""}
    ${!plan ? `<div class="card callout accent" style="margin-bottom:16px">
        <b>Aún no tienes un plan activo.</b> Crea uno de 30, 60 o 90 días para fijar tus objetivos semanales.
        <div style="margin-top:10px"><a class="btn primary" href="#/plan">Crear mi plan</a></div></div>` : ""}

    <div class="grid cols-4" style="margin-bottom:16px">
      ${statTile({
        label: "Peso actual", value: fmt.dec(d.weight), unit: "kg",
        foot: lost == null ? `<a href="#/progreso">Registrar peso</a>`
          : Math.abs(lost) < 0.05 ? `Sin cambios desde el inicio del plan · <a href="#/progreso">Registrar peso</a>`
          : lost > 0 ? `<span class="delta-good">−${fmt.dec(lost)} kg</span> desde el inicio del plan`
          : `<span class="delta-bad">+${fmt.dec(-lost)} kg</span> desde el inicio del plan`,
      })}
      ${statTile({ label: "IMC", value: fmt.dec(mt.bmi), foot: esc(mt.bmi_class || "Completa tu perfil") })}
      ${statTile({
        label: "Calorías esta semana", value: fmt.int(w.kcal), unit: "kcal", meterClass: "kcal",
        target: w.targets.kcal, current: w.kcal,
        foot: w.targets.kcal ? `Objetivo semanal: ${fmt.int(w.targets.kcal)} kcal` : "Sin objetivo definido",
      })}
      ${statTile({
        label: "Sesiones esta semana", value: `${w.sessions_count}${w.targets.sessions ? ` / ${w.targets.sessions}` : ""}`,
        target: w.targets.sessions, current: w.sessions_count,
        foot: `${fmt.int(w.minutes)} min de ${w.targets.minutes ? fmt.int(w.targets.minutes) : "–"} objetivo`,
      })}
    </div>

    ${weighReminder(weights, d.today)}
    ${nx ? nutritionCard(nx) : ""}

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2" id="todayCard"></div>
      <div class="card" id="planCard"></div>
    </div>

    <div class="grid cols-3">
      <div class="card span-2">
        <div class="card-head"><div><h2>Calorías por semana</h2><div class="sub">Últimas 12 semanas · gasto estimado por ejercicio</div></div></div>
        <div id="histChart"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Músculos esta semana</h2><div class="sub">Series efectivas por región</div></div>
          <a class="btn sm" href="#/semana">Ver semana</a></div>
        <div id="bodyMap"></div>
      </div>
    </div>`;

  // ----- Rutina de hoy -----
  const today = el.querySelector("#todayCard");
  const r = d.today_routine;
  if (r) {
    today.innerHTML = `
      <div class="card-head">
        <div><h2>Hoy: ${esc(r.name)}</h2>
          <div class="sub">${r.items.length} ejercicios · ~${fmt.int(r.estimate.minutes)} min · ~${fmt.int(r.estimate.kcal)} kcal</div></div>
        ${d.today_done ? `<span class="status good">Completada hoy</span>`
          : `<a class="btn primary" href="#/entrenar?routine=${r.id}">${ICON.play}Empezar entrenamiento</a>`}
      </div>
      <div class="table-wrap"><table>
        <tbody>${r.items.map((it) => {
          const ex = store.byId.get(it.exercise_id);
          return ex ? `<tr><td style="width:52px"><img class="mini-thumb" src="${ex.image}" alt=""></td>
            <td><div class="ex-name">${esc(ex.name)}</div><div class="small muted">${esc(ex.target_es)}${it.notes ? " · " + esc(it.notes) : ""}</div></td>
            <td class="num nowrap">${esc(prescriptionText(it))}</td></tr>` : "";
        }).join("")}</tbody></table></div>`;
  } else {
    const wd = store.meta.weekdays[d.weekday];
    today.innerHTML = `<div class="card-head"><h2>Hoy · ${esc(wd)}</h2></div>
      <div class="empty" style="padding:20px">
        <h3>${plan ? "Día de descanso o actividad libre" : "Sin rutina programada"}</h3>
        <p>${plan ? "Recuperar también es entrenar. Si te apetece, registra una caminata suave de 30-45 min."
          : "Crea un plan y asigna rutinas a cada día de la semana."}</p>
        <div class="row" style="margin-top:12px;justify-content:center">
          <a class="btn" href="#/entrenar">Registrar actividad</a>
          ${plan ? `<a class="btn" href="#/plan">Editar calendario</a>` : ""}
        </div>
      </div>`;
  }

  // ----- Plan -----
  const pc = el.querySelector("#planCard");
  if (plan && g) {
    const goalPct = startW && plan.goal_weight && d.weight
      ? Math.max(0, Math.min(100, ((startW - d.weight) / (startW - plan.goal_weight)) * 100)) : null;
    pc.innerHTML = `
      <div class="card-head"><div><h2>${esc(plan.name)}</h2>
        <div class="sub">Día ${Math.max(0, g.day)} de ${g.days} · termina el ${fmt.date(g.end_date)}</div></div></div>
      <div class="progress-track" title="Progreso temporal del plan"><span style="width:${g.progress}%"></span></div>
      <p class="small muted" style="margin-top:6px">${fmt.dec(g.progress)} % del plan completado</p>
      ${goalPct != null ? `
        <div style="margin-top:16px" class="row between"><b>Objetivo de peso</b><span class="small">${fmt.dec(startW)} → ${fmt.dec(plan.goal_weight)} kg</span></div>
        <div class="progress-track" style="margin-top:6px"><span style="width:${goalPct}%;background:var(--good)"></span></div>
        <p class="small muted" style="margin-top:6px">${fmt.int(goalPct)} % del objetivo alcanzado</p>` : ""}
      <div class="callout" style="margin-top:16px"><b>${esc(g.phase.name)}.</b> ${esc(g.phase.tip)}</div>`;
  } else {
    pc.innerHTML = `<div class="card-head"><h2>Tu plan</h2></div>
      <p class="muted">Define duración, peso objetivo y sesiones por semana.</p>
      <a class="btn primary" style="margin-top:12px" href="#/plan">Configurar plan</a>`;
  }

  // ----- Gráficos -----
  barChart(el.querySelector("#histChart"), d.history.map((h) => ({
    label: fmt.dayMonth(h.start), value: h.kcal, title: `Semana del ${fmt.date(h.start)}`,
    rows: [["Calorías", `${fmt.int(h.kcal)} kcal`], ["Minutos", fmt.int(h.minutes)], ["Sesiones", h.sessions]],
  })), { color: "var(--kcal)", target: w.targets.kcal, targetLabel: "Objetivo", ariaLabel: "Calorías por semana" });
  renderBodyMap(el.querySelector("#bodyMap"), w.regions);
}

/** Recordatorio de pesaje semanal: la app afina las metas con tus pesos. */
function weighReminder(weights, today) {
  const last = weights[weights.length - 1];
  const days = last ? daysBetween(last.date, today) : null;
  if (days != null && days < 7) return "";
  return `<div class="callout" style="margin-bottom:16px"><span class="status warning">Pesaje semanal</span>
    ${days == null ? "Aún no has registrado tu peso." : `Tu último pesaje fue hace ${days} días.`}
    Pésate en ayunas y regístralo: así la app compara el peso real con el esperado y ajusta tus metas.
    <a href="#/progreso">Registrar peso</a></div>`;
}

/** Resumen de nutrición del día y balance con el entrenamiento. */
function nutritionCard(nx) {
  const t = nx.targets, s = nx.state;
  if (!t.ok) return `<div class="card callout accent" style="margin-bottom:16px"><b>Nutrición:</b> ${esc(t.reason)} <a href="#/plan">Completar perfil</a></div>`;
  const spent = t.base + nx.exerciseToday;
  const bal = Math.round(s.tot.kcal - spent);
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-head"><div><h2>Nutrición de hoy</h2><div class="sub">Comida y entrenamiento conectados: balance = consumido − gastado</div></div>
      <a class="btn sm primary" href="#/comer">${ICON.plus}Registrar comida</a></div>
    <div class="kv">
      <div><div class="k">Consumido</div><div class="v">${fmt.int(s.tot.kcal)} / ${fmt.int(t.kcal)} kcal</div></div>
      <div><div class="k">Te quedan</div><div class="v">${fmt.int(Math.max(0, s.remaining))} kcal</div></div>
      <div><div class="k">Proteína</div><div class="v">${fmt.int(s.tot.prot)} / ${t.prot} g</div></div>
      <div><div class="k">Gastado hoy</div><div class="v">${fmt.int(spent)} kcal</div></div>
      <div><div class="k">Balance</div><div class="v">${bal > 0 ? "+" : ""}${fmt.int(bal)} kcal</div></div>
      <div><div class="k">Pérdida prevista</div><div class="v">${fmt.dec(t.expectedWeeklyLoss)} kg/sem</div></div>
    </div></div>`;
}
