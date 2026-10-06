// Эталонная база для замера производительности (v1.1): поздняя партия бота из архива → src/data/refbase.ts.
// npx tsx tools/refbase.ts [tests/saves/v1.0-late.z7save]
import fs from 'fs';
const src = process.argv[2] || 'tests/saves/v1.0-late.z7save';
const str = fs.readFileSync(src, 'utf8').trim();
fs.writeFileSync('src/data/refbase.ts', `// Эталонная база для замера производительности — создано tools/refbase.ts из ${src}. Не править вручную.\nexport const REF_BASE: string = ${JSON.stringify(str)};\n`);
console.log(`src/data/refbase.ts: ${Math.round(str.length / 1024)} КБ из ${src}`);
