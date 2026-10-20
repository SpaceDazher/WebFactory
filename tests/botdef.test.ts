// v1.14.1: бот с Роем и обороной — первые 2,5 игровых часа (радары, посты турелей, набег волны). Полное прохождение до ракеты:
//   npm run bot -- --enemies normal --raids 20     (≈ 40 минут реального времени)
export {};
process.env.BOT_ENEMIES = 'normal'; process.env.BOT_RAIDS = '20';
const { Run } = await import('../tools/bot/script');
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const LIMIT = 150 * 3600;
const bot = new Run(1, { checkpointMin: 60, verbose: false });
console.log('Бот: обычный режим Роя, набег раз в 20 минут, 2,5 игровых часа');
const t = bot.main(); const t0 = Date.now();
for (;;) { const r = t.next(); if (r.done) break; const n = (r.value as number) || 1; for (let i = 0; i < n; i++) bot.tick(); if (bot.g.tick > LIMIT) break; }
const g = bot.g; const d = bot.def;
console.log(`  игровое время ${(g.tick / 216000).toFixed(1)} ч за ${((Date.now() - t0) / 1000).toFixed(0)} с; эволюция ${g.evolution.toFixed(3)}, построек ${g.ents.size}`);
ok(g.settings.enemies === 'normal', 'партия идёт в обычном режиме Роя');
ok(d.radars >= 3, `радары открыли карту (${d.radars})`);
ok([...g.ents.values()].some(e => e.t === 'nest'), 'гнёзда появились на открытой карте');
ok(d.posts >= 1 && d.guns >= 4, `посты построены: постов ${d.posts}, пулемётных турелей ${d.guns}`);
ok([...g.ents.values()].filter(e => e.proto === 'gun-turret').every(e => (e.ammo?.count || 0) > 0), 'у всех пулемётных турелей есть патроны');
ok(bot.raids >= 1 && g.sw.total >= 1, `набегов ${bot.raids}, атак Роя ${g.sw.total}`);
const kills = Object.values(g.sw.kills).reduce((a: number, b: any) => a + b, 0);
ok(kills >= 5, `турели убили ${kills} юнитов`);
ok(!g.player.dead, 'инженер жив');
ok(bot.checkpoints.every(c => c.ok), 'сохранение и загрузка с Роем совпали');
console.log(fails ? `\n✘ Провалов: ${fails}` : '\n✔ бот с обороной: всё прошло');
process.exit(fails ? 1 : 0);
