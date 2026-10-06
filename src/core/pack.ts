// Сжатие строк (12, 16.1): JSON → deflate → base64 с префиксом версии "0".
// CompressionStream есть в браузерах (Chrome 80+, Firefox 113+, Safari 16.4+) и в Node 18+. Без него — запасной формат "J" + JSON.
// Данные подаются в поток напрямую, без Blob.stream(): в Safari Blob из Worker'а на странице с file://
// (origin «null») не читается — «NotReadableError: The I/O read operation failed», и сохранение не создавалось.
async function through(data: Uint8Array, ts: { readable: ReadableStream<Uint8Array>; writable: WritableStream<any> }): Promise<Uint8Array> {
  const w = ts.writable.getWriter();
  const out = new Response(ts.readable).arrayBuffer();
  w.write(data).catch(() => { /* ошибку вернёт out */ }); w.close().catch(() => { /* ошибку вернёт out */ });
  return new Uint8Array(await out);
}
function toB64(u: Uint8Array): string { let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); }
function fromB64(s: string): Uint8Array { const bin = atob(s.replace(/\s+/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
export async function packStr(obj: any): Promise<string> {
  const str = JSON.stringify(obj);
  if (typeof CompressionStream === 'undefined') return 'J' + str;
  try { return '0' + toB64(await through(new TextEncoder().encode(str), new CompressionStream('deflate'))); }
  catch (e) { console.warn('deflate недоступен, сохраняю без сжатия:', e); return 'J' + str; }
}
export async function unpackStr(s: string): Promise<any> {
  s = s.trim().replace(/^\uFEFF/, '');
  if (s[0] === 'J') return JSON.parse(s.slice(1));
  if (s[0] === '{') return JSON.parse(s); // «сырой» JSON (отладка, ручная правка сохранения)
  if (s[0] !== '0') throw new Error('Неизвестный формат строки');
  if (typeof DecompressionStream === 'undefined') throw new Error('Браузер не умеет распаковывать сохранения (нужен Chrome 80+, Firefox 113+ или Safari 16.4+)');
  const txt = new TextDecoder().decode(await through(fromB64(s.slice(1)), new DecompressionStream('deflate')));
  return JSON.parse(txt);
}
