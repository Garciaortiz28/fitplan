// Componentes de nutrición: buscador/registro de alimentos y escáner de código de barras.
import { api } from "./api.js";
import { esc, fmt, openModal, toast, nowCO, ICON } from "./util.js";
import * as N from "./nutri.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ROLE_FILTERS = [["", "Todos"], ["plato", "Platos"], ["proteina", "Proteínas"], ["almidon", "Cereales y tubérculos"],
  ["leguminosa", "Granos"], ["verdura", "Verduras"], ["fruta", "Frutas"], ["lacteo", "Lácteos"], ["grasa", "Grasas"],
  ["dulce", "Dulces"], ["bebida", "Bebidas"], ["U", "Mis alimentos"]];

/** Lista combinada: base TCAC + platos por receta + alimentos propios/escaneados. */
export function allFoods(customs) {
  return [...(customs || []).map(N.customToFood), ...N.foodsDB().foods];
}

export { ROLE_FILTERS };
export function searchFoods(list, q, role) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return list.filter((f) => {
    if (role === "U") { if (f.g !== "U") return false; } else if (role && f.role !== role) return false;
    if (!terms.length) return true;
    const hay = f._s || (f._s = norm(`${f.n} ${N.ROLE_LABEL[f.role] || ""} ${f.barcode || ""}`));
    return terms.every((t) => hay.includes(t));
  }).sort((a, b) => {
    // Primero lo propio y los platos colombianos, luego lo cocido/listo para comer, luego nombres cortos.
    const score = (f) => (f.g === "U" ? 0 : f.g === "X" ? 1 : f.g === "S" ? 2 : 3)
      + (/(cocid|asad|horne|frit|plancha)/.test(norm(f.n)) ? -0.5 : 0) + f.n.length / 200
      + (terms.length && norm(f.n).startsWith(terms[0]) ? -1 : 0);
    return score(a) - score(b);
  });
}

function foodRow(f) {
  return `<div class="picker-item" data-food="${esc(f.id)}">
    <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13.5px">${esc(f.n)}</div>
      <div class="small muted">${esc(N.ROLE_LABEL[f.role] || "")} · ${fmt.int(f.k)} kcal/100 g · P ${fmt.dec(f.p || 0)} · G ${fmt.dec(f.f || 0)} · C ${fmt.dec(f.c || 0)}${f.g === "X" ? " · receta" : f.g === "U" ? " · propio" : ""}</div></div>
    ${(f.fl || []).includes("antojo") ? `<span class="chip">antojo</span>` : ""}
  </div>`;
}

/**
 * Registro de un alimento: busca → elige porción → evalúa (hora de Colombia, presupuesto) → guarda.
 * ctx: {date, targets, state, settings, customs, meal?, preset?: {food, grams}}
 */
export function openFoodLogger(ctx, onSaved) {
  const list = allFoods(ctx.customs);
  const now = nowCO();
  const isToday = ctx.date === now.date;
  const m = openModal({ title: "Registrar alimento", wide: true, html: `<div id="flStep"></div>` });
  const step = m.el.querySelector("#flStep");
  let role = "", query = "";

  const showSearch = () => {
    step.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <input id="flQ" type="search" placeholder="Busca: arroz, arepa, pollo, ajiaco, bocadillo…" style="flex:1;min-width:200px" value="${esc(query)}">
        <button class="btn" id="flScan">${SCAN_ICON}Código de barras</button>
        <button class="btn" id="flNew">${ICON.plus}Alimento propio</button>
      </div>
      <div class="chips" style="margin-bottom:10px" id="flRoles">${ROLE_FILTERS.map(([k, l]) => `<button class="chip btn-chip ${k === role ? "on" : ""}" data-r="${k}">${l}</button>`).join("")}</div>
      <div class="picker-list" id="flList"></div>
      <p class="small muted" style="margin-top:8px">Valores por 100 g de la Tabla de Composición de Alimentos Colombianos (ICBF 2018). Las recetas se calculan con sus ingredientes.</p>`;
    const draw = () => {
      const res = searchFoods(list, query, role).slice(0, 80);
      step.querySelector("#flList").innerHTML = res.map(foodRow).join("") || `<div class="empty">Sin resultados. Prueba con otra palabra o crea un alimento propio.</div>`;
    };
    const q = step.querySelector("#flQ");
    q.addEventListener("input", () => { query = q.value; draw(); });
    step.querySelector("#flRoles").addEventListener("click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      role = b.dataset.r;
      step.querySelectorAll("#flRoles .chip").forEach((c) => c.classList.toggle("on", c === b));
      draw();
    });
    step.querySelector("#flList").addEventListener("click", (e) => {
      const it = e.target.closest("[data-food]");
      if (it) showPortion(list.find((f) => f.id === it.dataset.food));
    });
    step.querySelector("#flScan").addEventListener("click", () => openBarcode(ctx, (food) => { list.unshift(food); showPortion(food); }));
    step.querySelector("#flNew").addEventListener("click", () => openCustomFoodForm({}, (food) => { list.unshift(food); showPortion(food); }));
    draw();
    setTimeout(() => q.focus(), 50);
  };

  const showPortion = (food, gramsPreset) => {
    const time0 = isToday ? now.time : (ctx.settings.meals[ctx.meal] || "12:00");
    const meal0 = ctx.meal || N.mealForTime(N.toMin(time0), ctx.settings);
    const rec0 = N.recommendGrams(food, meal0, ctx.targets, ctx.state);
    const g0 = gramsPreset || rec0.grams || food.m?.[0]?.[1] || 100;
    step.innerHTML = `
      <button class="btn sm ghost" id="flBack">${ICON.left}Volver a buscar</button>
      <h3 style="margin:10px 0 2px">${esc(food.n)}</h3>
      <p class="small muted">${esc(N.ROLE_LABEL[food.role] || "")} · por 100 g: ${fmt.int(food.k)} kcal · proteína ${fmt.dec(food.p || 0)} g · grasa ${fmt.dec(food.f || 0)} g · carbohidratos ${fmt.dec(food.c || 0)} g${food.fi != null ? ` · fibra ${fmt.dec(food.fi)} g` : ""}</p>
      ${food.ing ? `<p class="small muted">Receta: ${food.ing.filter(([c]) => c !== "AGUA").map(([c, g]) => `${esc(N.shortName(N.foodsDB().byId.get(c)?.n || c))} ${g} g`).join(" · ")}</p>` : ""}
      <div class="form-grid" style="margin-top:14px">
        <label class="field">Comida<select id="flMeal">${Object.entries(N.MEAL_LABEL).map(([k, l]) => `<option value="${k}" ${k === meal0 ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field">Hora (Colombia)<input id="flTime" type="time" value="${time0}"></label>
        <label class="field">Cantidad (g)<input id="flGrams" type="number" min="1" max="5000" step="1" value="${g0}"></label>
      </div>
      <div class="chips" style="margin-top:10px" id="flMeasures">${(food.m || []).map(([l, g]) => `<button class="chip btn-chip" data-g="${g}">${esc(l)} · ${g} g</button>`).join("")}</div>
      <div class="callout accent" style="margin-top:14px" id="flRec"></div>
      <div class="kv" style="margin-top:14px" id="flMacros"></div>
      <div id="flEval" style="margin-top:14px"></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button class="btn primary" id="flSave">${ICON.check}Guardar</button>
      </div>`;
    const $ = (s) => step.querySelector(s);
    const update = () => {
      const grams = Number($("#flGrams").value) || 0;
      const meal = $("#flMeal").value;
      const minutes = N.toMin($("#flTime").value || time0);
      const rec = N.recommendGrams(food, meal, ctx.targets, ctx.state);
      const ev = N.evaluate(food, grams, minutes, ctx.settings, ctx.targets, ctx.state);
      $("#flRec").innerHTML = ev.level === "no" && ev.night
        ? `<b>A esta hora no te recomiendo este alimento.</b> Si tienes hambre, elige una de las alternativas ligeras de abajo; si igual lo vas a comer, que sea una porción pequeña.`
        : rec.grams == null ? "Completa tu perfil para recibir recomendaciones de cantidad."
        : rec.grams === 0 ? `<b>Recomendación:</b> ${esc(rec.why)}.`
        : `<b>Te recomiendo ${rec.grams} g</b> ${esc(N.nearestMeasure(food, rec.grams))} — ${esc(rec.why)}.
           <button class="btn sm" id="flUseRec" style="margin-left:6px">Usar ${rec.grams} g</button>`;
      $("#flUseRec")?.addEventListener("click", () => { $("#flGrams").value = rec.grams; update(); });
      const p = N.portion(food, grams);
      $("#flMacros").innerHTML = `
        <div><div class="k">Calorías</div><div class="v">${fmt.int(p.kcal)} kcal</div></div>
        <div><div class="k">Proteína</div><div class="v">${fmt.dec(p.prot)} g</div></div>
        <div><div class="k">Grasa</div><div class="v">${fmt.dec(p.fat)} g</div></div>
        <div><div class="k">Carbohidratos</div><div class="v">${fmt.dec(p.carb)} g</div></div>`;
      const cls = ev.level === "no" ? "critical" : ev.level === "aviso" ? "warning" : "good";
      const label = ev.level === "no" ? "No recomendado" : ev.level === "aviso" ? "Con precaución" : "Buena elección";
      $("#flEval").innerHTML = `<div class="callout"><span class="status ${cls}">${label}</span>
          ${ev.msgs.length ? ev.msgs.map((t) => `<p style="margin-top:6px">${esc(t)}</p>`).join("") : `<p style="margin-top:6px">Encaja en tu plan de hoy.</p>`}
          ${ev.alternatives.length ? `<p style="margin-top:10px"><b>${ev.night ? "Si tienes hambre a esta hora, mejor:" : "Alternativas que encajan mejor:"}</b></p>
          <div class="chips" style="margin-top:6px">${ev.alternatives.map((a, i) => `<button class="chip btn-chip" data-alt="${i}">${esc(N.shortName(a.food.n))} · ${a.grams} g · ${a.kcal} kcal</button>`).join("")}</div>` : ""}
        </div>`;
      $("#flEval").querySelectorAll("[data-alt]").forEach((b) => b.addEventListener("click", () => {
        const a = ev.alternatives[Number(b.dataset.alt)];
        showPortion(a.food, a.grams);
      }));
    };
    $("#flBack").addEventListener("click", showSearch);
    $("#flMeasures").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { $("#flGrams").value = b.dataset.g; update(); } });
    ["#flGrams", "#flMeal", "#flTime"].forEach((s) => $(s).addEventListener("input", update));
    $("#flSave").addEventListener("click", async () => {
      const grams = Number($("#flGrams").value);
      if (!(grams > 0)) { toast("Indica la cantidad en gramos.", "error"); return; }
      const p = N.portion(food, grams);
      try {
        const saved = await api.post("/api/foodlog", {
          date: ctx.date, time: $("#flTime").value || time0, meal: $("#flMeal").value, food_id: food.id,
          name: food.n, grams, kcal: p.kcal, prot: p.prot, fat: p.fat, carb: p.carb, fiber: p.fiber,
          flags: (food.fl || []).filter((f) => ["antojo", "alcohol", "procesado", "carne_roja", "frito", "pesado", "azucar"].includes(f)),
        });
        toast(`Registrado: ${N.shortName(food.n)} · ${p.kcal} kcal`);
        m.close();
        onSaved?.(saved);
      } catch (err) { toast(err.message, "error"); }
    });
    update();
  };

  if (ctx.preset) showPortion(ctx.preset.food, ctx.preset.grams);
  else showSearch();
  return m;
}

// ---------------------------------------------------------------- alimento propio

const ROLE_OPTIONS = Object.entries(N.ROLE_LABEL).filter(([k]) => k !== "plato");

/** Formulario de alimento propio (valores por 100 g). preset puede venir de Open Food Facts. */
export function openCustomFoodForm(preset, onSaved, existing) {
  const v = { name: "", brand: "", barcode: "", kcal: "", prot: "", fat: "", carb: "", fiber: "", unit_name: "", unit_grams: "", role: "otro", flags: [], source: "manual", ...preset, ...(existing || {}) };
  const m = openModal({
    title: existing ? "Editar alimento propio" : "Nuevo alimento propio", html: `
      <form id="cfForm" class="stack" style="gap:12px">
        ${v.source === "off" ? `<div class="callout small">Datos de <b>Open Food Facts</b> (base abierta y colaborativa). Revisa que coincidan con la etiqueta del empaque.</div>` : ""}
        <div class="form-grid">
          <label class="field">Nombre<input name="name" required maxlength="120" value="${esc(v.name)}"></label>
          <label class="field">Marca <span class="hint">opcional</span><input name="brand" maxlength="80" value="${esc(v.brand)}"></label>
          <label class="field">Código de barras <span class="hint">opcional</span><input name="barcode" inputmode="numeric" maxlength="32" value="${esc(v.barcode)}"></label>
          <label class="field">Tipo<select name="role">${ROLE_OPTIONS.map(([k, l]) => `<option value="${k}" ${k === v.role ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <b>Por cada 100 g</b>
        <div class="form-grid">
          <label class="field">Calorías (kcal)<input name="kcal" type="number" step="0.1" min="0" max="950" required value="${v.kcal}"></label>
          <label class="field">Proteína (g)<input name="prot" type="number" step="0.1" min="0" max="100" value="${v.prot}"></label>
          <label class="field">Grasa (g)<input name="fat" type="number" step="0.1" min="0" max="100" value="${v.fat}"></label>
          <label class="field">Carbohidratos (g)<input name="carb" type="number" step="0.1" min="0" max="100" value="${v.carb}"></label>
          <label class="field">Fibra (g)<input name="fiber" type="number" step="0.1" min="0" max="100" value="${v.fiber}"></label>
        </div>
        <div class="form-grid">
          <label class="field">Porción habitual <span class="hint">p. ej. «1 paquete»</span><input name="unit_name" maxlength="40" value="${esc(v.unit_name)}"></label>
          <label class="field">Gramos de esa porción<input name="unit_grams" type="number" step="0.1" min="0.1" max="5000" value="${v.unit_grams ?? ""}"></label>
        </div>
        <label class="check"><input type="checkbox" name="antojo" ${v.flags.includes("antojo") ? "checked" : ""}> <span>Es un antojo / dulce (cuenta en tu margen de antojos)</span></label>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">${ICON.check}Guardar alimento</button></div>
      </form>` });
  m.el.querySelector("#cfForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries([...f.entries()].filter(([k]) => k !== "antojo"));
    const flags = new Set((v.flags || []).filter((x) => x !== "antojo"));
    if (f.get("antojo")) flags.add("antojo");
    if (Number(body.fat) >= 15) flags.add("pesado");
    body.flags = [...flags];
    body.source = v.source;
    try {
      const saved = existing ? await api.put(`/api/foods/custom/${existing.id}`, body) : await api.post("/api/foods/custom", body);
      toast("Alimento guardado");
      m.close();
      onSaved?.(N.customToFood(saved), saved);
    } catch (err) { toast(err.message, "error"); }
  });
  return m;
}

// ------------------------------------------------------------- código de barras

const SCAN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20 6v12"/></svg>`;

function loadScanner() {
  if (window.__Html5QrcodeLibrary__) return Promise.resolve(window.__Html5QrcodeLibrary__);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/html5-qrcode.min.js";
    s.onload = () => resolve(window.__Html5QrcodeLibrary__);
    s.onerror = () => reject(new Error("No se pudo cargar el lector de códigos."));
    document.head.appendChild(s);
  });
}

/** Consulta Open Food Facts (base abierta) y devuelve datos por 100 g, o null si no existe. */
async function lookupOFF(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_es,brands,nutriments,serving_quantity,serving_size,categories_tags`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  if (d.status !== 1 || !d.product) return null;
  const p = d.product, n = p.nutriments || {};
  const kcal = n["energy-kcal_100g"] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
  if (kcal == null) return { name: p.product_name_es || p.product_name || "", brand: p.brands || "", barcode: code, source: "off" };
  const sugar = n.sugars_100g || 0, prot = n.proteins_100g || 0, fat = n.fat_100g || 0, carb = n.carbohydrates_100g || 0;
  const role = sugar >= 20 ? "dulce" : prot >= 15 ? "proteina" : fat >= 25 ? "grasa" : carb >= 40 ? "almidon" : "otro";
  const flags = [];
  if (sugar >= 15 || role === "dulce") flags.push("antojo");
  if (sugar >= 40) flags.push("azucar");
  return {
    name: (p.product_name_es || p.product_name || "Producto").slice(0, 120), brand: (p.brands || "").split(",")[0].slice(0, 80),
    barcode: code, kcal: Math.round(kcal * 10) / 10, prot: Math.round(prot * 10) / 10, fat: Math.round(fat * 10) / 10,
    carb: Math.round(carb * 10) / 10, fiber: Math.round((n.fiber_100g || 0) * 10) / 10, role, flags, source: "off",
    unit_name: p.serving_quantity ? "1 porción (etiqueta)" : "", unit_grams: p.serving_quantity ? Number(p.serving_quantity) : "",
  };
}

export function openBarcode(ctx, onFood) {
  const m = openModal({ title: "Escanear código de barras", html: `
    <div id="bcReader" style="width:100%;max-width:420px;margin:0 auto;border-radius:12px;overflow:hidden;background:#000;min-height:40px"></div>
    <p class="small muted" style="margin-top:8px;text-align:center" id="bcMsg">Iniciando cámara…</p>
    <div class="row" style="margin-top:12px">
      <input id="bcCode" inputmode="numeric" placeholder="O escribe el código (EAN)" style="flex:1;min-width:160px">
      <button class="btn primary" id="bcGo">Buscar</button>
    </div>
    <label class="btn sm" style="margin-top:10px;cursor:pointer">Usar una foto del código<input type="file" accept="image/*" capture="environment" id="bcFile" hidden></label>
    <p class="small muted" style="margin-top:10px">La información nutricional se consulta en Open Food Facts (requiere conexión). Solo se envía el número del código.</p>` });
  let scanner = null, done = false;
  const msg = (t) => { const el = m.el.querySelector("#bcMsg"); if (el) el.textContent = t; };
  const stop = async () => { try { if (scanner?.isScanning) await scanner.stop(); } catch { /* ya detenido */ } };
  const origClose = m.close;
  m.close = () => { stop(); origClose(); };
  // Apaga la cámara se cierre como se cierre la ventana (botón, Esc o clic fuera).
  const watch = setInterval(() => { if (!document.body.contains(m.el)) { clearInterval(watch); stop(); } }, 500);

  const handle = async (code) => {
    code = String(code || "").replace(/\D/g, "");
    if (code.length < 6) { toast("Código no válido.", "error"); return; }
    if (done) return;
    done = true;
    await stop();
    msg(`Buscando ${code}…`);
    const mine = (ctx.customs || []).find((c) => c.barcode === code);
    if (mine) { m.close(); onFood(N.customToFood(mine)); return; }
    let data = null;
    try { data = await lookupOFF(code); } catch { /* sin conexión */ }
    m.close();
    if (data && data.kcal != null) {
      openCustomFoodForm(data, (food, saved) => { ctx.customs?.push(saved); onFood(food); });
    } else {
      toast(data ? "El producto existe pero no tiene información nutricional: complétala con la etiqueta." : "Producto no encontrado o sin conexión: créalo con los datos de la etiqueta.");
      openCustomFoodForm({ barcode: code, ...(data || {}), source: data ? "off" : "manual" }, (food, saved) => { ctx.customs?.push(saved); onFood(food); });
    }
  };

  m.el.querySelector("#bcGo").addEventListener("click", () => handle(m.el.querySelector("#bcCode").value));
  m.el.querySelector("#bcFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const lib = await loadScanner();
      await stop();
      const F = lib.Html5QrcodeSupportedFormats;
      const s = new lib.Html5Qrcode("bcReader", { verbose: false, formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128] });
      const code = await s.scanFile(file, false);
      handle(code);
    } catch { toast("No se pudo leer el código en la foto. Prueba con más luz o escríbelo.", "error"); }
  });

  loadScanner().then((lib) => {
    if (done) return;
    const F = lib.Html5QrcodeSupportedFormats;
    // Los formatos se configuran en el constructor (API de html5-qrcode 2.3.x).
    scanner = new lib.Html5Qrcode("bcReader", { verbose: false, formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128] });
    return scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 260, height: 140 } },
      (text) => handle(text), () => {}).then(() => msg("Apunta al código de barras del empaque."));
  }).catch(() => msg("No se pudo usar la cámara (permiso denegado o no disponible). Escribe el código o usa una foto."));
  return m;
}
