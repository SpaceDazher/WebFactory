// Хранилище сохранений (16.1): IndexedDB, запасной вариант — localStorage.
// Сохранения сотни КБ – единицы МБ; localStorage ограничен ~5 МБ на сайт, IndexedDB — сотни МБ.
const DB = 'zavod7', OS = 'saves';
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(OS)) r.result.createObjectStore(OS); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function backend(): Promise<'indexeddb' | 'localstorage'> { return (await db()) ? 'indexeddb' : 'localstorage'; }
export async function put(key: string, val: string) {
  const d = await db(); if (!d) { localStorage.setItem('zavod7:' + key, val); return; }
  await req(d.transaction(OS, 'readwrite').objectStore(OS).put(val, key));
}
export async function get(key: string): Promise<string | null> {
  const d = await db(); if (!d) return localStorage.getItem('zavod7:' + key);
  const v = await req(d.transaction(OS, 'readonly').objectStore(OS).get(key)); return v == null ? null : String(v);
}
export async function del(key: string) {
  const d = await db(); if (!d) { localStorage.removeItem('zavod7:' + key); return; }
  await req(d.transaction(OS, 'readwrite').objectStore(OS).delete(key));
}
/** перенос старых сохранений v0.1–v0.3 из localStorage в IndexedDB */
export async function migrateFromLocal(slots: string[]): Promise<number> {
  const d = await db(); if (!d) return 0; let n = 0;
  for (const s of slots) { const v = localStorage.getItem('zavod7:' + s); if (v == null) continue; await put(s, v); localStorage.removeItem('zavod7:' + s); n++; }
  return n;
}
/** просим браузер не удалять данные при нехватке места (risk «потеря сохранений», раздел 18) */
export async function persist(): Promise<boolean | null> {
  try { if (!navigator.storage?.persist) return null; if (await navigator.storage.persisted()) return true; return await navigator.storage.persist(); } catch { return null; }
}
export async function usage(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
