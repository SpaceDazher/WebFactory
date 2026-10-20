import fs from 'node:fs';
import path from 'node:path';
import { zip } from '../src/mods/zip';
import { nodeDeflate } from '../tools/modfs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: zip-dir.ts <directory> <output.zip>');

const files: Record<string, Uint8Array> = {};
function collect(dir: string, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(full, name);
    else if (entry.isFile()) files[name] = new Uint8Array(fs.readFileSync(full));
    else throw new Error(`Unsupported archive entry: ${name}`);
  }
}

collect(path.resolve(input));
const target = path.resolve(output);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, await zip(files, nodeDeflate));
