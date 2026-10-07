import { api } from "../api.js";
import { esc, fmt, toast, confirmDialog, emptyState, debounce, ICON } from "../util.js";
import * as N from "../nutri.js";
import { loadNutritionContext } from "../nutrictx.js";
import { allFoods, searchFoods, ROLE_FILTERS, openFoodLogger, openCustomFoodForm, openBarcode } from "../foodui.js";

const state = { q: "", role: "" };

export async function render(el) {
  const ctx = await loadNutritionContext();
  const reload = () => render(el);
  const list = allFoods(ctx.customs);
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Alimentos</h1><p>${N.foodsDB().foods.length} alimentos colombianos (TCAC 2018 del ICBF y platos típicos) + tus alimentos propios.</p></div>
      <div class="row"><button class="btn" id="scan">Escanear código</button><button class="btn primary" id="new">${ICON.plus}Alimento propio</button></div>
    </div>
    <div class="row" style="margin-bottom:10px"><input id="q" type="search" placeholder="Buscar alimento…" value="${esc(state.q)}" style="flex:1"></div>
    <div class="chips" style="margin-bottom:14px" id="roles">${ROLE_FILTERS.map(([k, l]) => `<button class="chip btn-chip ${k === state.role ? "on" : ""}" data-r="${k}">${l}</button>`).join("")}</div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>Alimento</th><th>Tipo</th><th class="num">kcal</th><th class="num">Proteína</th><th class="num">Grasa</th><th class="num">Carbohidratos</th><th class="num">Fibra</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div></div>
    <p class="small muted" style="margin-top:8px" id="count"></p>
    <p class="small muted" style="margin-top:4px">Valores por 100 g de parte comestible. Fuente: Tabla de Composición de Alimentos Colombianos 2018, ICBF.</p>`;
  const $ = (s) => el.querySelector(s);

  const draw = () => {
    const res = searchFoods(list, state.q, state.role);
    const shown = res.slice(0, 150);
    $("#rows").innerHTML = shown.map((f) => `<tr>
      <td><div>${esc(f.n)}</div><div class="small muted">${f.g === "U" ? (f.src === "off" ? "Open Food Facts" : "Propio") : f.g === "X" ? "Receta colombiana" : esc(N.foodsDB().groups[f.g] || "")}${(f.fl || []).includes("antojo") ? " · antojo" : ""}${(f.fl || []).includes("pesado") ? " · pesado de noche" : ""}</div></td>
      <td class="small">${esc(N.ROLE_LABEL[f.role] || "")}</td>
      <td class="num">${fmt.int(f.k)}</td><td class="num">${fmt.dec(f.p || 0)}</td><td class="num">${fmt.dec(f.f || 0)}</td>
      <td class="num">${fmt.dec(f.c || 0)}</td><td class="num">${f.fi == null ? "–" : fmt.dec(f.fi)}</td>
      <td class="nowrap" style="text-align:right">
        <button class="btn sm" data-log="${esc(f.id)}">${ICON.plus}Registrar</button>
        ${f.g === "U" ? `<button class="btn ghost icon" data-edit="${esc(f.id)}" aria-label="Editar">${ICON.edit}</button>
          <button class="btn ghost icon danger" data-del="${esc(f.id)}" aria-label="Eliminar">${ICON.trash}</button>` : ""}
      </td></tr>`).join("") || `<tr><td colspan="8">${emptyState("Sin resultados", "Prueba con otra palabra o crea un alimento propio.")}</td></tr>`;
    $("#count").textContent = res.length > shown.length ? `Mostrando ${shown.length} de ${res.length}. Afina la búsqueda.` : `${res.length} alimentos`;
  };
  $("#q").addEventListener("input", debounce((e) => { state.q = e.target.value; draw(); }, 150));
  $("#roles").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    state.role = b.dataset.r;
    $("#roles").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    draw();
  });
  $("#rows").addEventListener("click", async (e) => {
    const log = e.target.closest("[data-log]"), edit = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if (log) {
      const food = list.find((f) => f.id === log.dataset.log);
      openFoodLogger({ ...ctx, preset: { food, grams: N.recommendGrams(food, N.mealForTime(720, ctx.settings), ctx.targets, ctx.state).grams || food.m?.[0]?.[1] || 100 } }, () => {});
    } else if (edit) {
      const c = ctx.customs.find((x) => `U:${x.id}` === edit.dataset.edit);
      openCustomFoodForm({}, reload, c);
    } else if (del) {
      const c = ctx.customs.find((x) => `U:${x.id}` === del.dataset.del);
      if (!(await confirmDialog(`¿Eliminar «${c.name}»? Los registros ya guardados se conservan.`, { ok: "Eliminar", danger: true }))) return;
      try { await api.del(`/api/foods/custom/${c.id}`); toast("Alimento eliminado"); reload(); } catch (err) { toast(err.message, "error"); }
    }
  });
  $("#new").addEventListener("click", () => openCustomFoodForm({}, reload));
  $("#scan").addEventListener("click", () => openBarcode(ctx, reload));
  draw();
}
