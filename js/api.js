// Cliente de datos de la versión móvil: misma interfaz que la versión de PC,
// pero las peticiones se resuelven en el propio dispositivo (localapi.js + IndexedDB).
import { handle } from "./localapi.js";

const clone = (v) => (v === undefined ? v : typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

async function request(method, url, body) {
  return clone(await handle(method, url, body === undefined ? undefined : clone(body)));
}

export const api = {
  get: (u) => request("GET", u),
  post: (u, b = {}) => request("POST", u, b),
  put: (u, b = {}) => request("PUT", u, b),
  del: (u) => request("DELETE", u),
};

export const store = {
  mode: "local",
  meta: null,
  exercises: [],
  byId: new Map(),
  profile: null,
};

export async function loadBase() {
  const [meta, exercises, profile] = await Promise.all([
    api.get("/api/meta"),
    api.get("/api/exercises"),
    api.get("/api/profile"),
  ]);
  store.meta = meta;
  store.exercises = exercises;
  store.byId = new Map(exercises.map((e) => [e.id, e]));
  store.profile = profile;
}

export async function refreshProfile() {
  store.profile = await api.get("/api/profile");
  return store.profile;
}

export const regionLabel = (k) => (store.meta?.region_labels || {})[k] || k;
export const equipmentLabel = (k) => (store.meta?.equipment_labels || {})[k] || k;
