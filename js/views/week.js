import { api, regionLabel } from "../api.js";
import { esc, fmt, toast, todayISO, addDays, weekStartISO, confirmDialog, emptyState, ICON } from "../util.js";
import { barChart, hbars } from "../charts.js";
import { renderBodyMap } from "../bodymap.js";
import { statTile } from "../components.js";
import { navigate } from "../app.js";

// Rangos orientativos de series semanales por grupo muscular (principiante-intermedio).
const SET_RANGE = { min: 6, max: 20 };

export async function render(el, r) {
  const start = weekStartISO(r.query.start || todayISO());
  const w = await api.get(`/api/stats/week?start=${start}`);
  const isCurrent = start === weekStartISO(todayISO());
  const t = w.targets;
  const range = `${fmt.dayMonth(w.start)} – ${fmt.dayMonth(w.end)}`;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Resumen semanal</h1><p>Qué hiciste, qué partes del cuerpo trabajaste y cuánta energía gastaste.</p></div>
      <div class="week-nav">
        <button class="btn icon" id="prev" aria-label="Semana anterior">${ICON.left}</button>
        <span class="label">${esc(range)}</span>
        <button class="btn icon" id="next" aria-label="Semana siguiente" ${isCurrent ? "disabled" : ""}>${ICON.right}</button>
        ${isCurrent ? "" : `<button class="btn sm" id="cur">Esta semana</button>`}
      </div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px">
      ${statTile({ label: "Calorías quemadas", value: fmt.int(w.kcal), unit: "kcal", target: t.kcal, current: w.kcal, meterClass: "kcal",
        foot: t.kcal ? `${fmt.int((w.kcal / t.kcal) * 100)} % del objetivo (${fmt.int(t.kcal)})` : "" })}
      ${statTile({ label: "Tiempo activo", value: fmt.int(w.minutes), unit: "min", target: t.minutes, current: w.minutes,
        foot: t.minutes ? `Objetivo: ${fmt.int(t.minutes)} min` : "" })}
      ${statTile({ label: "Sesiones", value: `${w.sessions_count}${t.sessions ? ` / ${t.sessions}` : ""}`, target: t.sessions, current: w.sessions_count,
        foot: `${w.active_days} días activos` })}
      ${statTile({ label: "Distribución", value: `${fmt.int(w.kinds.fuerza)}<small>min fuerza</small>`,
        foot: `${fmt.int(w.kinds.cardio)} min cardio · ${fmt.int(w.kinds.flexibilidad)} min movilidad` })}
    </div>

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2">
        <div class="card-head"><div><h2>Por día</h2><div class="sub">Pasa el cursor por cada barra para ver el detalle</div></div>
          <div class="seg" id="metric"><button class="on" data-m="kcal">Calorías</button><button data-m="minutes">Minutos</button></div></div>
        <div id="dayChart"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Partes del cuerpo</h2><div class="sub">Series realizadas por zona</div></div></div>
        <div id="bp"></div>
      </div>
    </div>

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><div><h2>Mapa muscular</h2><div class="sub">Series efectivas (principal = 1, secundario = 0,5)</div></div></div>
        <div id="map"></div>
      </div>
      <div class="card span-2">
        <div class="card-head"><div><h2>Volumen por músculo</h2>
          <div class="sub">Referencia orientativa: ${SET_RANGE.min}-${SET_RANGE.max} series semanales por grupo para progresar</div></div></div>
        <div class="table-wrap"><table id="regTable"></table></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Ejercicios realizados</h2><span class="sub">${w.exercises.length} distintos</span></div>
      <div class="table-wrap" id="exTable"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Sesiones</h2><a class="btn sm primary" href="#/entrenar">${ICON.plus}Registrar</a></div>
      <div id="sessions"></div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  $("#prev").addEventListener("click", () => navigate(`#/semana?start=${addDays(start, -7)}`));
  $("#next").addEventListener("click", () => navigate(`#/semana?start=${addDays(start, 7)}`));
  $("#cur")?.addEventListener("click", () => navigate("#/semana"));

  const drawDays = (metric) => {
    const perDay = metric === "kcal" ? (t.kcal && t.sessions ? t.kcal / t.sessions : null) : (t.minutes && t.sessions ? t.minutes / t.sessions : null);
    barChart($("#dayChart"), w.by_day.map((d) => ({
      label: d.label, value: d[metric], title: fmt.dateLong(d.date),
      rows: [["Calorías", `${fmt.int(d.kcal)} kcal`], ["Minutos", fmt.int(d.minutes)], ["Sesiones", d.sessions]],
    })), { color: metric === "kcal" ? "var(--kcal)" : "var(--minutes)", target: perDay,
      targetLabel: "Media por sesión objetivo", ariaLabel: metric === "kcal" ? "Calorías por día" : "Minutos por día" });
  };
  drawDays("kcal");
  $("#metric").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("#metric").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    drawDays(b.dataset.m);
  });

  $("#bp").innerHTML = hbars(w.body_parts.map((b) => ({ label: b.label, value: b.sets, display: `${b.sets}` })), { unit: "series" });
  renderBodyMap($("#map"), w.regions);

  const regs = Object.entries(w.regions).filter(([k]) => k !== "cardio").sort((a, b) => b[1] - a[1]);
  $("#regTable").innerHTML = regs.length ? `
    <thead><tr><th>Músculo</th><th class="num">Series</th><th>Valoración</th></tr></thead>
    <tbody>${regs.map(([k, v]) => {
      const s = v > SET_RANGE.max ? ["critical", "Volumen muy alto"]
        : v >= SET_RANGE.min ? ["good", "En rango"]
        : isCurrent ? ["info", "Semana en curso"] : ["warning", "Por debajo del rango"];
      return `<tr><td>${esc(regionLabel(k))}</td><td class="num">${fmt.dec(v)}</td><td><span class="status ${s[0]}">${s[1]}</span></td></tr>`;
    }).join("")}</tbody>` : `<tbody><tr><td>${emptyState("Sin series esta semana", "Registra una sesión para ver el reparto muscular.")}</td></tr></tbody>`;

  $("#exTable").innerHTML = w.exercises.length ? `<table>
    <thead><tr><th></th><th>Ejercicio</th><th>Zona</th><th class="num">Veces</th><th class="num">Series</th><th class="num">Reps</th><th class="num">Carga máx.</th><th class="num">Min</th><th class="num">Kcal</th></tr></thead>
    <tbody>${w.exercises.map((x) => `<tr>
      <td style="width:52px"><img class="mini-thumb" src="${x.image}" alt=""></td>
      <td><div class="ex-name">${esc(x.name)}</div><div class="small muted">${esc(x.pattern)}</div></td>
      <td>${esc(x.body_part_es)}</td><td class="num">${x.times}</td><td class="num">${x.sets}</td>
      <td class="num">${x.reps || "–"}</td><td class="num">${x.max_weight ? fmt.kg(x.max_weight) : "–"}</td>
      <td class="num">${fmt.int(x.minutes)}</td><td class="num">${fmt.int(x.kcal)}</td></tr>`).join("")}</tbody></table>`
    : emptyState("Sin ejercicios registrados", "Cuando registres sesiones aparecerán aquí.");

  const sessEl = $("#sessions");
  sessEl.innerHTML = w.sessions.length ? w.sessions.map((s) => `
    <div class="list-item">
      <div style="flex:1;min-width:0">
        <div class="row"><b>${esc(s.name)}</b><span class="chip">${esc(fmt.dateLong(s.date))}</span>${s.rpe ? `<span class="chip">RPE ${s.rpe}</span>` : ""}</div>
        <div class="small muted" style="margin-top:3px">${s.entries.length} ejercicios · ${fmt.int(s.duration_min)} min · ${fmt.int(s.kcal)} kcal${s.notes ? " · " + esc(s.notes) : ""}</div>
      </div>
      <a class="btn sm" href="#/entrenar?session=${s.id}&date=${s.date}">${ICON.edit}Editar</a>
      <button class="btn sm ghost danger" data-del="${s.id}" aria-label="Eliminar sesión">${ICON.trash}</button>
    </div>`).join("") : emptyState("Sin sesiones esta semana", "¡Empieza hoy! Cada sesión cuenta.");
  sessEl.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    if (!(await confirmDialog("¿Eliminar esta sesión? Esta acción no se puede deshacer.", { ok: "Eliminar", danger: true }))) return;
    try {
      await api.del(`/api/sessions/${b.dataset.del}`);
      toast("Sesión eliminada");
      render(el, r);
    } catch (err) { toast(err.message, "error"); }
  });
}
