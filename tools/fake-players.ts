// СИНТЕТИЧЕСКИЕ файлы плейтеста — только для проверки tools/stats-report.ts (tests/stats.test.ts).
// Каждый файл помечен "synthetic": true, сводка выводит предупреждение. Это не данные игроков.
// npx tsx tools/fake-players.ts <папка> [--n 24] [--seed 1] [--speed 2.9]  — шаблон: docs/bot-report-1.0.json (прохождение бота)
import fs from 'fs';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0]; if (!out || out.startsWith('--')) { console.error('укажите папку'); process.exit(2); }
const N = +opt('n', '24'), SPEED = +opt('speed', '2.9'); let s = +opt('seed', '1') >>> 0;
const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const logn = (sigma: number) => Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R()));
const bot = JSON.parse(fs.readFileSync(opt('template', 'docs/bot-report-1.0.json'), 'utf8')).tele;
const GPUS = ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M1', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL 4.6)', 'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)'];
fs.mkdirSync(out, { recursive: true });
for (let i = 0; i < N; i++) {
  const k = SPEED * logn(0.25);                     // во сколько раз игрок медленнее бота
  const quitAt = R() < 0.15 ? 2 + Math.floor(R() * 4) : R() < 0.35 ? 6 + Math.floor(R() * 10) : 99; // бросил после цели №
  const sc = (m: number) => Math.round(m * k * (0.85 + 0.3 * R()) * 10) / 10;
  const goals = bot.goals.filter((g: any) => g.n <= quitAt).map((g: any) => ({ ...g, min: sc(g.min) })).sort((a: any, b: any) => a.min - b.min);
  const last = goals.length ? goals[goals.length - 1].min : 5;
  const end = quitAt === 99 ? null : last + 5 + R() * 60;
  const playMin = Math.round((end ?? sc(bot.playMin)) * 10) / 10;
  const keep = (m: number) => m <= playMin;
  const techs = bot.techs.map((t: any) => ({ ...t, min: sc(t.min) })).filter((t: any) => keep(t.min));
  const packs = Object.fromEntries(Object.entries(bot.packs).map(([p, m]) => [p, sc(m as number)]).filter(([, m]) => keep(m as number)));
  const rocketMin = bot.rocketMin != null && keep(sc(bot.rocketMin)) && quitAt === 99 ? sc(bot.rocketMin) : null;
  const checklist = bot.checklist.map((c: any) => { const ok = R() < 0.93; const m = Math.round(c.limit * (ok ? 0.3 + 0.6 * R() : 1.1 + R()) * 10) / 10; return { ...c, min: m, ok }; });
  const nErr = R() < 0.2 ? 1 + Math.floor(R() * 2) : 0;
  const errors = Array.from({ length: nErr }, () => ({ min: Math.round(R() * playMin), sig: R() < 0.5 ? 'TypeError: Cannot read properties of undefined (reading \'lanes\')' : 'WebGL: CONTEXT_LOST_WEBGL' }));
  const stalls = R() < 0.4 ? [{ goal: 3, min: 30, x: 10, y: -5, problems: [['drill:output-full', 4], ['furnace:no-fuel', 2]], goalText: '', stalledMin: 20 }] : [];
  const gpu = GPUS[i % GPUS.length];
  const rep = { format: 'zavod7-playtest', v: 2, synthetic: true, seed: 1000 + i, mode: 'normal', tick: Math.round(playMin * 3600), playMin, fromMin: 0, recording: true,
    goalNow: { n: goals.length + 1, goal: null, sinceMin: 0 }, goals, techs, packs, rocketMin, rockets: rocketMin ? [rocketMin] : [], checklist,
    deaths: R() < 0.3 ? [{ tick: 1, x: 0, y: 0, evo: 0.1, goal: 6, min: 100 }] : [], stalls, stuck: R() < 0.2 ? [{ tick: 1, x: 12.5, y: -3.2, sec: 4, min: 15 }] : [],
    firstBuilt: {}, samplesCols: bot.samplesCols, samples: [], sessions: [[0, playMin]], errors, totals: { ...bot.totals, rockets: rocketMin ? 1 : 0 },
    client: { version: '1.1.0', installId: 'fake' + String(i).padStart(3, '0'), system: { browser: 'Chrome 130', os: 'Windows', gpu }, perf: { fpsAvg: Math.round(45 + R() * 15) }, errors: nErr } };
  fs.writeFileSync(`${out}/zavod7-playtest-fake-${String(i).padStart(3, '0')}.json`, JSON.stringify(rep));
}
console.log(`записано ${N} синтетических файлов в ${out}`);
