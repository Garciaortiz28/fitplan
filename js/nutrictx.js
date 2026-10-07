// Contexto de nutrición: une perfil, plan de entrenamiento, ajustes, registros y gasto.
import { api } from "./api.js";
import { todayISO } from "./util.js";
import * as N from "./nutri.js";

export async function loadNutritionContext(date = todayISO()) {
  await N.loadFoods();
  const today = todayISO();
  const [settings, plans, profile, customs, logs, energy] = await Promise.all([
    api.get("/api/nutrition/settings"), api.get("/api/plans"), api.get("/api/profile"),
    api.get("/api/foods/custom"), api.get(`/api/foodlog?from=${date}&to=${date}`), api.get(`/api/energy?to=${today}`),
  ]);
  const plan = plans.find((p) => p.active) || null;
  const weight = profile.current_weight;
  const base = N.computeTargets({ profile, weight, plan, settings, today });
  const adaptive = N.adaptiveEstimate(energy, base);
  const useAdapt = settings.adaptive && adaptive.ready && Math.abs(adaptive.factor - 1) >= 0.02;
  const targets = useAdapt ? N.computeTargets({ profile, weight, plan, settings, adaptFactor: adaptive.factor, today }) : base;
  const state = N.dayState(logs, targets);
  const exerciseToday = energy.exercise[date]?.kcal || 0;
  return { date, today, settings, plan, profile, weight, customs, logs, energy, targets, baseTargets: base, adaptive, useAdapt, state, exerciseToday };
}
