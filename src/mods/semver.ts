// v1.10: версии модов (semver: 1.2.3, 1.2.3-beta) и диапазоны: >=1.10, <2, =1.0.0, ^1.2, ~1.2.3, 1.x, *, «>=1.0 <2.0» (И), «1.x || 2.x» (ИЛИ).
export type Ver = [number, number, number, string];
export function parseVer(s: string): Ver | null {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?\s*$/.exec(String(s ?? '')); if (!m) return null;
  return [+m[1], m[2] == null ? 0 : +m[2], m[3] == null ? 0 : +m[3], m[4] || ''];
}
export const isSemver = (s: string) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(s ?? ''));
export function cmpVer(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number) ? -1 : 1;
  if (a[3] === b[3]) return 0; if (!a[3]) return 1; if (!b[3]) return -1; return a[3] < b[3] ? -1 : 1; // 1.0.0-beta < 1.0.0
}
/** версия игры для сравнения: «1.10.0», «dev» — считается самой новой */
export function gameVer(v: string): Ver { return parseVer(v) || [999, 0, 0, '']; }
function one(v: Ver, c: string): boolean | null {
  c = c.trim(); if (!c || c === '*' || c === 'x') return true;
  let m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(c); if (!m) return null; const op = m[1] || '';
  let body = m[2].trim();
  // 1.x / 1.2.x / 1 / 1.2 без оператора — диапазон по префиксу
  const parts = body.split('.'); const wild = parts.length < 3 || parts.some(p => p === 'x' || p === '*');
  if (wild && (op === '' || op === '=')) {
    const nums = parts.filter(p => p !== 'x' && p !== '*').map(Number); if (nums.some(n => !Number.isInteger(n))) return null;
    return nums.every((n, i) => v[i] === n);
  }
  body = parts.map(p => (p === 'x' || p === '*') ? '0' : p).join('.');
  const b = parseVer(body); if (!b) return null; const k = cmpVer(v, b);
  switch (op) {
    case '>=': return k >= 0; case '<=': return k <= 0; case '>': return k > 0; case '<': return k < 0; case '': case '=': return k === 0;
    case '^': return k >= 0 && (b[0] > 0 ? v[0] === b[0] : b[1] > 0 ? v[0] === 0 && v[1] === b[1] : v[0] === 0 && v[1] === 0 && v[2] === b[2]);
    case '~': return k >= 0 && v[0] === b[0] && v[1] === b[1];
  }
  return null;
}
/** удовлетворяет ли версия диапазону; null — диапазон записан с ошибкой */
export function satisfies(ver: string | Ver, range: string): boolean | null {
  const v = typeof ver === 'string' ? parseVer(ver) : ver; if (!v) return null;
  const r = String(range ?? '').trim(); if (!r) return true;
  let any = false;
  for (const alt of r.split('||')) {
    const cs = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    let all = true; for (const c of cs) { const x = one(v, c); if (x === null) return null; if (!x) all = false; }
    if (all) any = true;
  }
  return any;
}
