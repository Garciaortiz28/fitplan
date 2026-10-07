import { api } from "../api.js";
import { esc, fmt, cap, toast, nowCO, todayISO, addDays, confirmDialog, emptyState, openModal, ICON } from "../util.js";
import * as N from "../nutri.js";
import { loadNutritionContext } from "../nutrictx.js";
import { openFoodLogger, openBarcode } from "../foodui.js";
import { statTile } from "../components.js";
import { navigate } from "../app.js";

let clockTimer = null;

export async function render(el, r) {
  const date = r.query.fecha || todayISO();
  const ctx = await loadNutritionContext(date);
  const { targets: t, state: s, settings } = ctx;
  const now = nowCO();
  const isToday = date === now.date;
  const minutes = isToday ? now.minutes : N.toMin(settings.meals.almuerzo);
  const next = N.nextMeal(minutes, settings);
  const reload = () => render(el, r);

  const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);
  const spentToday = t.ok ? t.base + ctx.exerciseToday : null;
  const balance = t.ok ? Math.round(s.tot.kcal - spentToday) : null;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Nutrición${isToday ? " · Hoy" : ""}</h1>
        <p>${cap(esc(fmt.dateLong(date)))} · <span id="coClock">Hora Colombia ${now.time}</span></p></div>
      <div class="week-nav">
        <button class="btn icon" id="dPrev" aria-label="Día anterior">${ICON.left}</button>
        ${isToday ? "" : `<button class="btn sm" id="dToday">Hoy</button>`}
        <button class="btn icon" id="dNext" aria-label="Día siguiente" ${isToday ? "disabled" : ""}>${ICON.right}</button>
      </div>
    </div>

    ${!t.ok ? `<div class="card callout accent" style="margin-bottom:16px"><b>Falta información:</b> ${esc(t.reason)}
      <div style="margin-top:10px"><a class="btn primary" href="#/plan">Completar perfil</a></div></div>` : ""}

    <div class="grid cols-4" style="margin-bottom:16px">
      ${statTile({ label: "Consumido", value: fmt.int(s.tot.kcal), unit: t.ok ? `/ ${fmt.int(t.kcal)} kcal` : "kcal", target: t.ok ? t.kcal : null, current: s.tot.kcal, meterClass: "kcal",
        foot: t.ok ? (s.remaining >= 0 ? `Te quedan <b>${fmt.int(s.remaining)} kcal</b>` : `<span class="delta-bad">${fmt.int(-s.remaining)} kcal por encima</span>`) : "" })}
      ${statTile({ label: "Proteína", value: fmt.int(s.tot.prot), unit: t.ok ? `/ ${t.prot} g` : "g", target: t.ok ? t.prot : null, current: s.tot.prot,
        foot: "Clave para no perder músculo mientras bajas de peso" })}
      ${statTile({ label: "Margen de antojos", value: fmt.int(s.tot.antojo), unit: t.ok ? `/ ${fmt.int(t.extra)} kcal` : "kcal", target: t.ok ? t.extra : null, current: s.tot.antojo, meterClass: "kcal",
        foot: "Dulces y gustos incluidos en tu plan, sin culpa" })}
      ${statTile({ label: "Balance del día", value: balance == null ? "–" : `${balance > 0 ? "+" : ""}${fmt.int(balance)}`, unit: "kcal",
        foot: t.ok ? `Gasto estimado ${fmt.int(spentToday)} kcal (${fmt.int(t.base)} base + ${fmt.int(ctx.exerciseToday)} ejercicio)` : "" })}
    </div>

    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card span-2" id="nextCard"></div>
      <div class="card">
        <div class="card-head"><h2>Acciones rápidas</h2></div>
        <div class="stack" style="gap:8px">
          <button class="btn primary" id="addFood">${ICON.plus}Registrar alimento</button>
          <button class="btn" id="craving">Tengo antojo o hambre</button>
          <button class="btn" id="scan">Escanear código de barras</button>
        </div>
        ${t.ok ? `<div class="callout small" style="margin-top:14px">Meta diaria: <b>${fmt.int(t.kcal)} kcal</b> · P ${t.prot} g · G ${t.fat} g · C ${t.carb} g · fibra ≥ ${t.fiber} g.
          ${ctx.useAdapt ? `<br>Ajustada a tu evolución real (×${String(ctx.adaptive.factor).replace(".", ",")}).` : ""}
          <a href="#/nutricion">Ver detalle</a></div>` : ""}
      </div>
    </div>

    <div class="grid cols-2" id="meals"></div>`;

  const $ = (q) => el.querySelector(q);

  // Reloj en hora de Colombia.
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const c = el.querySelector("#coClock");
    if (!c) { clearInterval(clockTimer); return; }
    c.textContent = `Hora Colombia ${nowCO().time}`;
  }, 15000);

  $("#dPrev").addEventListener("click", () => navigate(`#/comer?fecha=${addDays(date, -1)}`));
  $("#dNext").addEventListener("click", () => navigate(`#/comer?fecha=${addDays(date, 1)}`));
  $("#dToday")?.addEventListener("click", () => navigate("#/comer"));

  const logger = (extra = {}) => openFoodLogger({ ...ctx, ...extra }, reload);
  $("#addFood").addEventListener("click", () => logger());
  $("#scan").addEventListener("click", () => openBarcode(ctx, (food) => logger({ preset: { food, grams: food.m?.[0]?.[1] || 100 } })));
  $("#craving").addEventListener("click", () => openCraving(ctx, minutes, logger));

  // ----- Próxima comida y sugerencias colombianas
  const nc = $("#nextCard");
  if (!t.ok) {
    nc.innerHTML = `<div class="card-head"><h2>Sugerencias</h2></div><p class="muted">Completa tu perfil para recibir sugerencias.</p>`;
  } else {
    const meal = isToday ? next.meal : "almuerzo";
    const goal = Math.max(0, t.meals[meal] - s.byMeal[meal].kcal);
    const when = !isToday ? "" : next.tomorrow ? "mañana" : next.inMin > 0 ? `en ${next.inMin >= 60 ? `${Math.floor(next.inMin / 60)} h ` : ""}${next.inMin % 60} min` : "ahora";
    nc.innerHTML = `
      <div class="card-head"><div><h2>${isToday ? "Próxima comida" : "Ideas para el almuerzo"}: ${N.MEAL_LABEL[meal]} ${isToday ? `· ${next.time}` : ""}</h2>
        <div class="sub">${when ? `${cap(when)} · ` : ""}objetivo ${fmt.int(goal)} kcal · platos colombianos ajustados a tu meta</div></div>
        <div class="seg" id="mealSeg">${["desayuno", "almuerzo", "comida"].map((m) => `<button data-m="${m}" class="${m === meal ? "on" : ""}">${N.MEAL_LABEL[m]}</button>`).join("")}</div></div>
      <div id="sugList" class="stack" style="gap:10px"></div>`;
    const drawSug = (mk) => {
      const list = N.suggestMeals(mk, t, s, isToday ? minutes : null, settings);
      nc.querySelector("#sugList").innerHTML = list.length ? list.map((x, i) => `
        <div class="list-item" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="row"><b>${esc(x.food.n)}</b>${x.occasional ? `<span class="chip">ocasional</span>` : ""}</div>
            <div class="small muted" style="margin-top:3px">${x.ings.length ? x.ings.map((g) => `${esc(N.shortName(g.food.n))} ${g.grams} g`).join(" · ") : `${x.grams} g`}</div>
            <div class="small" style="margin-top:3px">${fmt.int(x.kcal)} kcal · P ${fmt.dec(x.prot)} g · G ${fmt.dec(x.fat)} g · C ${fmt.dec(x.carb)} g</div>
          </div>
          <button class="btn sm" data-sug="${i}" data-meal="${mk}">${ICON.plus}Registrar</button>
        </div>`).join("") : emptyState("Meta de esta comida cubierta", "Si tienes hambre, usa el asistente de antojos.");
      nc.querySelectorAll("[data-sug]").forEach((b) => b.addEventListener("click", () => {
        const x = list[Number(b.dataset.sug)];
        logger({ meal: b.dataset.meal, preset: { food: x.food, grams: x.grams } });
      }));
    };
    drawSug(meal);
    nc.querySelector("#mealSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      nc.querySelectorAll("#mealSeg button").forEach((x) => x.classList.toggle("on", x === b));
      drawSug(b.dataset.m);
    });
  }

  // ----- Comidas del día
  const mealsEl = $("#meals");
  mealsEl.innerHTML = Object.entries(N.MEAL_LABEL).map(([k, label]) => {
    const bm = s.byMeal[k];
    const goal = t.ok ? t.meals[k] : null;
    return `<div class="card">
      <div class="card-head"><div><h2>${label}</h2>
        <div class="sub">${k === "extra" ? "Antojos, onces y lo que comas fuera de horario" : `Hora sugerida ${settings.meals[k]}`}</div></div>
        <span class="small"><b>${fmt.int(bm.kcal)}</b>${goal ? ` / ${fmt.int(goal)} kcal` : " kcal"}</span></div>
      ${goal ? `<div class="meter kcal" style="margin:-6px 0 10px"><span style="width:${pct(bm.kcal, goal)}%"></span></div>` : ""}
      ${bm.items.length ? bm.items.map((l) => `
        <div class="list-item">
          <div style="flex:1;min-width:0"><div>${esc(l.name)}</div>
            <div class="small muted">${l.time} · ${fmt.int(l.grams)} g · P ${fmt.dec(l.prot)} · G ${fmt.dec(l.fat)} · C ${fmt.dec(l.carb)}${(l.flags || []).includes("antojo") ? " · antojo" : ""}</div></div>
          <b class="nowrap">${fmt.int(l.kcal)} kcal</b>
          <button class="btn ghost icon danger" data-del="${l.id}" aria-label="Eliminar">${ICON.trash}</button>
        </div>`).join("") : `<p class="small muted">Nada registrado.</p>`}
      <button class="btn sm" style="margin-top:10px" data-add="${k}">${ICON.plus}Añadir a ${label.toLowerCase()}</button>
    </div>`;
  }).join("");
  mealsEl.addEventListener("click", async (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return logger({ meal: add.dataset.add });
    const del = e.target.closest("[data-del]");
    if (del) {
      if (!(await confirmDialog("¿Eliminar este alimento del registro?", { ok: "Eliminar", danger: true }))) return;
      try { await api.del(`/api/foodlog/${del.dataset.del}`); toast("Eliminado"); reload(); } catch (err) { toast(err.message, "error"); }
    }
  });
}

/** Asistente de antojos: opciones según tipo de antojo, hora de Colombia y margen del día. */
function openCraving(ctx, minutes, logger) {
  const types = [["dulce", "Algo dulce"], ["salado", "Algo salado"], ["hambre", "Tengo hambre"], ["bebida", "Algo de tomar"]];
  const m = openModal({ title: "¿Qué se te antoja?", html: `
    <p class="muted">Nada está prohibido: te propongo opciones que encajan con lo que te queda hoy y con la hora (${N.fromMin(minutes)}).</p>
    <div class="seg" id="cvSeg" style="margin:12px 0">${types.map(([k, l], i) => `<button data-t="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="cvInfo" class="small muted" style="margin-bottom:10px"></div>
    <div id="cvList"></div>` });
  const draw = (type) => {
    const t = ctx.targets, s = ctx.state;
    m.el.querySelector("#cvInfo").innerHTML = t.ok
      ? `Te quedan <b>${fmt.int(Math.max(0, t.kcal - s.tot.kcal))} kcal</b> hoy y <b>${fmt.int(Math.max(0, t.extra - s.tot.antojo))} kcal</b> de antojos.`
      : "Completa tu perfil para ajustar las opciones a tu meta.";
    const opts = N.cravingOptions(type, minutes, ctx.settings, t, s);
    m.el.querySelector("#cvList").innerHTML = opts.map((o, i) => `
      <div class="list-item" style="${o.fits ? "" : "opacity:.6"}">
        <div style="flex:1;min-width:0"><div>${esc(o.food.n)}</div>
          <div class="small muted">${o.grams} g ${esc(N.nearestMeasure(o.food, o.grams))} · ${o.kcal} kcal · ${esc(o.note)}</div></div>
        <span class="status ${o.fits ? "good" : "warning"}">${o.fits ? "Encaja" : "Ojo"}</span>
        <button class="btn sm" data-o="${i}">Elegir</button>
      </div>`).join("");
    m.el.querySelectorAll("[data-o]").forEach((b) => b.addEventListener("click", () => {
      const o = opts[Number(b.dataset.o)];
      m.close();
      logger({ meal: N.mealForTime(minutes, ctx.settings) === "extra" || o.treat ? "extra" : N.mealForTime(minutes, ctx.settings), preset: { food: o.food, grams: o.grams } });
    }));
  };
  m.el.querySelector("#cvSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    m.el.querySelectorAll("#cvSeg button").forEach((x) => x.classList.toggle("on", x === b));
    draw(b.dataset.t);
  });
  draw("dulce");
}
