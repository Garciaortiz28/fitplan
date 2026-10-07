// Persistencia local en el dispositivo (IndexedDB). Todo el estado se mantiene en memoria
// y cada colección se guarda como un registro; las escrituras se serializan.

const DB_NAME = "fitplan";
const STORE = "kv";
const KEYS = ["profile", "plans", "routines", "sessions", "weights", "seq", "meta", "foodlog", "customFoods", "nsettings"];

export const DEFAULT_PROFILE = () => ({
  id: 1, name: "", sex: "", age: null, height_cm: null, weight_kg: null, activity: "sedentario",
  level: "principiante", equipment: [], low_impact: true, updated_at: null,
});

export const S = {
  profile: DEFAULT_PROFILE(), plans: [], routines: [], sessions: [], weights: [],
  seq: { plan: 0, routine: 0, session: 0, item: 0, entry: 0, food: 0, custom: 0 },
  meta: { last_export: null, created_at: null },
  foodlog: [], customFoods: [], nsettings: null,
};

let dbp = null;
function openDB() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("No se pudo abrir el almacenamiento del dispositivo."));
    });
  }
  return dbp;
}

export async function loadAll() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    for (const k of KEYS) {
      const r = st.get(k);
      r.onsuccess = () => { if (r.result !== undefined) S[k] = r.result; };
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  if (!S.meta.created_at) { S.meta.created_at = new Date().toISOString(); await save("meta"); }
}

let chain = Promise.resolve();
/** Guarda una o varias colecciones en una única transacción (atómica). */
export function save(...keys) {
  const snapshot = keys.map((k) => [k, structuredClone(S[k])]);
  // Un fallo previo no debe bloquear los guardados siguientes.
  chain = chain.catch(() => {}).then(async () => {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const [k, v] of snapshot) st.put(v, k);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("No se pudieron guardar los datos."));
      tx.onabort = () => reject(tx.error || new Error("Guardado cancelado (¿almacenamiento lleno?)."));
    });
  });
  return chain;
}

export function nextId(kind) {
  S.seq[kind] = (S.seq[kind] || 0) + 1;
  return S.seq[kind];
}

/** Pide al navegador que no borre los datos automáticamente. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    return await navigator.storage?.persisted?.();
  } catch { return false; }
}
