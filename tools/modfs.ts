// v1.10: моды в Node (тесты, бот, сборка архивов): папка или zip → файлы → пакет; применение набора.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { unzip, zip } from '../src/mods/zip';
import { parsePackage, ModPackage } from '../src/mods/mod';
import { applyMods } from '../src/mods/registry';
export const nodeInflate = async (d: Uint8Array) => new Uint8Array((zlib as any).inflateRawSync(d));
export const nodeDeflate = async (d: Uint8Array) => new Uint8Array((zlib as any).deflateRawSync(d, { level: 9 }));
export function readDir(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (d: string, pre: string) => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, pre + f + '/'); else out[pre + f] = new Uint8Array(fs.readFileSync(p)); } };
  walk(dir, ''); return out;
}
export async function readMod(p: string): Promise<ModPackage> {
  const files = fs.statSync(p).isDirectory() ? readDir(p) : await unzip(new Uint8Array(fs.readFileSync(p)), nodeInflate);
  return parsePackage(files, path.basename(p).replace(/\.zip$/i, ''));
}
export const zipDir = (dir: string) => zip(readDir(dir), nodeDeflate);
/** применить моды по путям (папки или zip); пустой список — встроенные данные */
export async function useMods(paths: string[], game = '1.10.0') { const pk = await Promise.all(paths.map(readMod)); return { pkgs: pk, report: applyMods(pk, [], game) }; }
