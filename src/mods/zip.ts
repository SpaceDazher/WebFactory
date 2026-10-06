// v1.10: минимальный zip без зависимостей — чтение (stored и deflate) и запись (deflate, если есть CompressionStream, иначе stored).
// Распаковка deflate — DecompressionStream('deflate-raw') в браузере; в Node передаётся своя функция (zlib.inflateRawSync).
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;
export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;
async function stream(data: Uint8Array, s: any): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(s)); return new Uint8Array(await out.arrayBuffer());
}
export const webInflate: Inflate | null = typeof DecompressionStream !== 'undefined' ? d => stream(d, new DecompressionStream('deflate-raw' as any)) : null;
export const webDeflate: Deflate | null = typeof CompressionStream !== 'undefined' ? d => stream(d, new CompressionStream('deflate-raw' as any)) : null;
const MAX_FILES = 2000, MAX_TOTAL = 64 << 20;
/** файлы архива: путь → содержимое. Ошибка — понятным текстом (битый архив, шифрование, слишком большой) */
export async function unzip(buf: Uint8Array, inflate: Inflate | null = webInflate): Promise<Record<string, Uint8Array>> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('это не zip-архив (нет оглавления)');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  if (n > MAX_FILES) throw new Error(`слишком много файлов в архиве (${n}, можно до ${MAX_FILES})`);
  const out: Record<string, Uint8Array> = {}; let total = 0; const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('архив повреждён (оглавление)');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/'); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`файл ${name} зашифрован — такие архивы не поддерживаются`);
    if (name.split('/').includes('..') || name.startsWith('/')) throw new Error(`недопустимый путь в архиве: ${name}`);
    total += usize; if (total > MAX_TOTAL) throw new Error('архив слишком большой (больше 64 МБ в распакованном виде)');
    if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error(`архив повреждён (${name})`);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = buf.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) { if (!inflate) throw new Error('браузер не умеет распаковывать zip (нет DecompressionStream)'); try { data = await inflate(raw); } catch { throw new Error(`архив повреждён (${name}: не распаковывается)`); } }
    else throw new Error(`файл ${name}: неизвестный способ сжатия ${method}`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`архив повреждён (${name}: контрольная сумма не сходится)`);
    out[name] = data;
  }
  return out;
}
let CRC: Uint32Array | null = null;
export function crc32(d: Uint8Array): number {
  if (!CRC) { CRC = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
/** собрать zip: файлы в порядке путей (одинаковый вход — одинаковый архив) */
export async function zip(files: Record<string, Uint8Array>, deflate: Deflate | null = webDeflate): Promise<Uint8Array> {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const cent: Uint8Array[] = []; let off = 0;
  for (const name of Object.keys(files).sort()) {
    const data = files[name], nm = enc.encode(name), crc = crc32(data);
    let body = data, method = 0; if (deflate && data.length > 64) { const z = await deflate(data); if (z.length < data.length) { body = z; method = 8; } }
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, method, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, method, true);
    c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, body); cent.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + body.length;
  }
  const csz = cent.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); const n = Object.keys(files).length; e.setUint16(8, n, true); e.setUint16(10, n, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
  const all = [...parts, ...cent, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let q = 0; for (const a of all) { out.set(a, q); q += a.length; }
  return out;
}
