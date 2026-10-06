// Точка входа: игровой цикл, ввод, сохранения.
import { Game, Entity, Command } from './sim/game';
import { serialize, deserialize, SAVE_VERSION } from './sim/save';
import { validateSave, reportText } from './sim/compat';
import { Renderer, View, LOD_ZOOM } from './render/renderer';
import { UI } from './ui/ui';
import { ITEMS, ITEM_IDX } from './data/items';
import { SUB_NAMES } from './sim/perf';
import { robotView, ROBOT_STRIDE } from './sim/robots';
import { WIRE_OF, circuitCapable, circuitsMs, termAt, wireAt, wt, hasOut, cleanCC } from './sim/circuits';
import { PROTOS, FLOOR_BY_ITEM, BRUSH_MIN, BRUSH_MAX, brushOrigin } from './data/entities';
import { RECIPES } from './data/recipes';
import { Dir } from './core/types';
import { generateTextures, texQuality, setTexQuality } from './render/textures';
import { detectPreset, presetSettings, matchPreset, FpsWatch, PRESETS, PRESET_NAMES, Preset } from './client/gfx';
import { wheelZoom, IS_MAC, uiScaleStyle, installGestures } from './client/input';
import type { EnemyMode } from './sim/enemies';
import { packStr as pack, unpackStr as unpack } from './core/pack';
import { Blueprint, makeBlueprint, rotateBp, flipBp } from './sim/blueprint';
import { GameAudio } from './client/audio';
import * as store from './client/store';
import { loadSettings, saveSettings, Settings, keyName } from './client/settings';
import { WorkerSim } from './client/mirror';
import { tr, setLang } from './core/i18n';
import { setColorblind, iconURL } from './render/art';
import * as beta from './client/beta';
import { teleReport } from './sim/telemetry';
import { Voice } from './client/voice';
import { GOALS } from './sim/goals';
import { slotInfo, slotInfoData, SlotInfo } from './sim/slotinfo';
import type { SaveMeta } from './ui/ui';
import { runBench, gpuName, BenchFile } from './client/perfbench';
import { REF_BASE } from './data/refbase';
import { statsView } from './sim/prodstats';
import { MpClient } from './client/mp';
import { MpUI } from './ui/mpui';
import { planRail, railEnds, railAt, carNear, trainMs, PlanPiece, graph as railGraph, nk, SIG_OX, SIG_OY } from './sim/trains';
import { shapeOf, pointOn, isRailProto } from './sim/railgeo';
import { T_SHALLOW } from './sim/world';
import { ModStore, modDiff, ModDiff } from './client/modstore';
import { applyMods, activeMods, lastApply, spriteFiles, ApplyReport } from './mods/registry';
import { errText } from './mods/mod';
import { ModsUI } from './ui/modsui';
import { setModArt, modSpriteCount } from './render/art';
declare const __FEEDBACK__: string;
/** v1.1: вкладка замера производительности (?bench=1) — эталонная база, без сохранений и автосохранений */
const BENCH = /[?&]bench=(1|mega)/.test(location.search), BENCH_MEGA = /[?&]bench=mega/.test(location.search);
const benchState = { running: false, text: '', frac: 0, file: null as BenchFile | null };

beta.installHooks();

const settings: Settings = loadSettings();
setLang(settings.lang); setColorblind(settings.colorblind);
const audio = new GameAudio(); audio.vol = { master: settings.master, sfx: settings.sfx, music: settings.music, ambient: settings.ambient };
// озвучка ОСКАРа и интерфейса: включается первым жестом игрока (браузеры не дают говорить раньше)
const voice = new Voice(audio, () => settings);
for (const evn of ['pointerdown', 'keydown']) window.addEventListener(evn, () => { audio.ensure(); voice.unlock(); }, { capture: true });
const K = (a: string) => settings.keys[a];
let shake = 0;
function applySettings() {
  audio.setVol({ master: settings.master, sfx: settings.sfx, music: settings.music, ambient: settings.ambient });
  document.querySelectorAll<HTMLElement>('.hud, #win, #tip').forEach(el => uiScaleStyle(el, settings.uiScale));
  view.smoke = settings.smoke; view.noNight = !settings.dayNight;
  R.resScale = settings.resScale; R.dprMax = settings.dprMax; R.detail = settings.detail; R.lod = settings.lod !== false;
  if (settings.gfx !== '') settings.gfx = matchPreset(settings, texQuality());
  const sig = settings.lang + settings.colorblind; setLang(settings.lang); setColorblind(settings.colorblind); document.title = tr('ЗАВОД-7');
  if (sig !== appliedSig) { appliedSig = sig; ui.render(true); }
}
let appliedSig = settings.lang + settings.colorblind;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const R = new Renderer(canvas);
const rq = /[?&]render=(webgl|canvas|legacy)/.exec(location.search);
R.setMode(rq ? rq[1] as any : settings.renderer || 'auto');
beta.log('info', `ZAVOD-7 v${beta.VERSION} · renderer ${R.mode}${R.modeNote ? ' (' + R.modeNote + ')' : ''}`);
// качество графики (п. 5 плана 1.0): при самом первом запуске подбираем по железу, у тех, кто уже играл, — оставляем как было
let gfxFirst: { preset: Preset; why: string[] } | null = null;
const forcedGfx = /[?&]gfx=(high|medium|low|min)/.exec(location.search); // ссылка ?gfx=min — помощь игроку со слабым ПК, действует всегда
if (settings.gfx === '' || forcedGfx) {
  const fresh = (() => { try { return localStorage.getItem('zavod7:settings') == null && localStorage.getItem('zavod7:tex') == null; } catch { return true; } })();
  const forced = forcedGfx;
  if (fresh || forced) {
    const nav: any = navigator;
    gfxFirst = forced ? { preset: forced[1] as Preset, why: ['?gfx'] } : detectPreset({ cores: nav.hardwareConcurrency, memGB: nav.deviceMemory, soft: R.modeNote === 'soft', nogl: R.modeNote === 'nogl', pixels: screen.width * screen.height * (devicePixelRatio || 1) ** 2 });
    Object.assign(settings, presetSettings(gfxFirst.preset), { gfxAuto: true }); try { setTexQuality(PRESETS[gfxFirst.preset].tex); } catch { /* без localStorage */ }
  } else settings.gfx = matchPreset(settings, texQuality());
  saveSettings(settings);
  beta.log('info', `graphics preset: ${settings.gfx}${gfxFirst ? ' (auto: ' + gfxFirst.why.join(', ') + ')' : ''}`);
}
R.resScale = settings.resScale; R.dprMax = settings.dprMax; R.detail = settings.detail; R.lod = settings.lod !== false;
const fpsWatch = new FpsWatch();
// симуляция: в отдельном Worker (по умолчанию) или в главном потоке (?local, настройка, нет Worker)
const workerSrc = document.getElementById('simworker')?.textContent || '';
const useWorker = settings.simWorker && !/[?&]local/.test(location.search) && typeof Worker !== 'undefined' && workerSrc.length > 1000;
let sim: WorkerSim | null = null;
if (useWorker) { try { sim = new WorkerSim(workerSrc); } catch (e) { console.warn('Worker недоступен, симуляция в главном потоке', e); sim = null; } }
let game: Game = sim ? sim.g : new Game(Math.floor(Math.random() * 1e9));
if (sim) sim.onReset = () => { game = sim!.g; };
let profDetail = false; // v1.9: подробный профайлер (Shift+F3)
const view: View = { zoom: 1, cursor: null, rot: 0, alt: false, mouseX: 0, mouseY: 0, mouseIn: false, hoverEnt: null, ghostOk: null, ghostPos: null, debug: false, brush: 1 };
const keys = new Set<string>();
let lmb = false, rmb = false, paused = false, speed = 1;
let drag: { x: number; y: number; dir: number; placed: boolean } | null = null;
let copiedRecipe: string | null = null;
/** v1.6: скопированные настройки схемотехники (Shift+ПКМ по комбинатору) — вставляются в постройку того же типа (Shift+ЛКМ) */
let copiedCC: { t: string; cc: any } | null = null;
let prevPX = 0, prevPY = 0;
let lastBp: Blueprint | null = null, lastPaste: [number, number] | null = null, seenRockets = 0;
let altHeld = false, altCombo = false;
type Tool = 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel';
const TOOL_NAMES: Record<Tool, string> = { copy: 'Копирование: протяните рамку ЛКМ', cut: 'Вырезание: протяните рамку ЛКМ', decon: 'Снос: рамка ЛКМ — пометить, ПКМ — снять', upgrade: 'Улучшение: рамка ЛКМ — пометить, ПКМ — снять', cancel: 'Отмена стройки: рамка ЛКМ — убрать призраки' };
function setTool(t: Tool | null) { view.tool = t; view.bp = null; view.sel = null; if (t) { view.cursor = null; game.msg(TOOL_NAMES[t]); } }
function takeBp(bp: Blueprint | null) { view.bp = bp; view.tool = null; view.sel = null; view.cursor = null; lastPaste = null; if (bp) lastBp = bp; }

// ---------- сохранения: IndexedDB (метаданные слотов — в localStorage) ----------
const PREFIX = 'zavod7:';
let storageInfo = '';
async function refreshStorageInfo() {
  const be = await store.backend(); const u = await store.usage(); const per = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : null;
  storageInfo = `${be === 'indexeddb' ? 'IndexedDB' : 'localStorage (IndexedDB недоступна)'}${u ? ` · занято ${(u.used / 1048576).toFixed(1)} МБ` : ''} · ${per ? 'постоянное хранилище ✔' : 'браузер может очистить данные при нехватке места — делайте экспорт в файл'}`;
}
type MetaRec = Omit<SaveMeta, 'slot'>;
const getMeta = (): Record<string, MetaRec> => { try { return JSON.parse(localStorage.getItem(PREFIX + 'meta') || '{}'); } catch { return {}; } };
const setMeta = (m: Record<string, MetaRec>) => { try { localStorage.setItem(PREFIX + 'meta', JSON.stringify(m)); } catch { // переполнение localStorage — без картинок
  for (const k in m) delete m[k].prev; localStorage.setItem(PREFIX + 'meta', JSON.stringify(m)); } };
// картинка базы для карточки сохранения: снимается в ближайшем кадре сразу после отрисовки; в фоновой вкладке кадров нет — тогда карта
const THUMB_W = 192, THUMB_H = 108;
let thumbReq: ((u: string | null) => void)[] = [];
function mapThumb(): string | null {
  try { const cv = document.createElement('canvas'); cv.width = THUMB_W; cv.height = THUMB_H; R.drawMap(game, cv, game.player.x, game.player.y, 1); return cv.toDataURL('image/jpeg', 0.75); } catch { return null; }
}
function takeThumb(): Promise<string | null> {
  return new Promise(res => { let done = false; const fin = (u: string | null) => { if (!done) { done = true; res(u || mapThumb()); } };
    thumbReq.push(fin); setTimeout(() => fin(null), document.hidden ? 0 : 500); });
}
async function saveTo(slot: string) {
  if (BENCH) { game.msg('Вкладка замера: сохранения отключены'); return; }
  const uiState = { hotbar: ui.hotbar, zoom: view.zoom };
  try {
    const thumb = takeThumb();
    let str: string, info: SlotInfo | undefined;
    if (sim) { const r = await sim.save(uiState); str = r.str; info = r.info; } else { const data = serialize(game); data.ui = uiState; str = await pack(data); info = slotInfo(game); }
    await store.put(slot, str);
    const meta = getMeta(); meta[slot] = { time: Date.now(), tick: info?.tick ?? game.tick, ...info, ver: beta.VERSION, kb: Math.round(str.length / 1024), prev: (await thumb) || undefined }; setMeta(meta);
    beta.log('info', `save ${slot}: tick ${game.tick}, ${Math.round(str.length / 1024)} KB`);
    if (!slot.startsWith('auto')) { game.msg('Сохранено в слот ' + slot); store.persist().then(refreshStorageInfo); }
  } catch (e) { game.msg('Ошибка сохранения: ' + (e as Error).message); }
}
async function deleteSave(slot: string) { await store.del(slot); const meta = getMeta(); delete meta[slot]; setMeta(meta); if (ui.open === 'menu') ui.render(true); }
/** слоты старых версий без сведений о партии: читаем файл один раз и дописываем сведения (картинка появится при следующем сохранении) */
let infoBusy = false;
async function fillSlotInfo() {
  if (infoBusy) return; infoBusy = true;
  try {
    for (const [slot, m] of Object.entries(getMeta())) {
      if (m.ents != null) continue; const str = await store.get(slot); if (!str) continue;
      try { const d = await unpack(str); const meta = getMeta(); if (!meta[slot]) continue; meta[slot] = { ...meta[slot], ...slotInfoData(d), kb: Math.round(str.length / 1024), time: meta[slot].time }; setMeta(meta); } catch { /* битый слот — без сведений */ }
      if (ui.open === 'menu') ui.render(true);
    }
  } finally { infoBusy = false; }
}
function applyLoaded(data: any, opt: { force?: boolean; label?: string } = {}) {
  beta.log('info', `load: seed ${data.seed}, tick ${data.tick}, save v${data.v}`);
  validateSave(data, SAVE_VERSION); // битый файл или сохранение из новой версии — ошибка сразу, текущая партия не трогается
  // v1.10: другой набор модов — спросить (включить нужные / загрузить без них / отмена)
  if (!opt.force && !BENCH) { const d = modDiff(Array.isArray(data.mods) ? data.mods : [], activeMods(), mods); if (!d.ok) { pendingLoad = { data, label: opt.label || tr('из файла'), diff: d }; beta.log('info', `load: mods differ (need ${d.need.map(n => n.ref.name).join(', ')}; extra ${d.extra.map(x => x.name).join(', ')})`); if (ui.open !== 'modcheck') ui.toggle('modcheck'); else ui.render(true); return false; } }
  if (sim) { sim.load(data); game = sim.g; } else { game = deserialize(data); const rt = reportText(game.loadReport, SAVE_VERSION); if (rt) game.msg(rt); }
  view.cursor = null;
  if (data.ui) { ui.hotbar = data.ui.hotbar || ui.hotbar; view.zoom = data.ui.zoom || 1; }
  prevPX = game.player.x; prevPY = game.player.y; seenRockets = data.rockets || 0; takeBp(null); setTool(null); ui.close(); voice.reset(); game.msg('Игра загружена');
  return true;
}
async function loadFrom(slot: string) {
  const s = await store.get(slot); if (!s) { game.msg('Слот пуст'); return; }
  try { return applyLoaded(await unpack(s), { label: slot.startsWith('auto') ? tr('Автосохранение') : tr('Слот') + ' ' + slot }); } catch (e) { alert(tr('Не удалось загрузить') + ': ' + (e as Error).message); return false; }
}
function listSaves(): SaveMeta[] { const meta = getMeta(); return Object.keys(meta).map(k => ({ slot: k, ...meta[k] })); }
let autoIdx = 0, lastAuto = performance.now();
function autosaveCheck(now: number) {
  if (paused || settings.autosaveMin <= 0 || now - lastAuto < settings.autosaveMin * 60000) return;
  lastAuto = now; saveTo('auto' + (autoIdx % 3 + 1)); autoIdx++;
}
function newGame(seed: number, mode: EnemyMode = 'normal') {
  beta.log('info', `new game: seed ${seed}, mode ${mode}`);
  if (sim) { sim.newGame(seed, mode); game = sim.g; } else game = new Game(seed, true, { enemies: mode }); ui.hotbar = new Array(10).fill(null); view.cursor = null; prevPX = game.player.x; prevPY = game.player.y; seenRockets = 0; takeBp(null); setTool(null); ui.close(); voice.reset();
  intro();
}
function intro() {
  game.msg('ОСКАР: Крушение на Кеплер-7b. Корпус разрушен, связи нет.');
  game.msg('ОСКАР: Построй завод и запусти маяк. Начни с добычи руды (ПКМ).');
}

// ---------- v1.10: моды ----------
const mods = new ModStore(); let modBusy = false; /** данные игры уже сменились, а партия ещё старая — кадр не рисуется */ let modSwap = false; let pendingLoad: { data: any; label: string; diff: ModDiff } | null = null;
/** применить включённые моды (главный поток и Worker); restart — партия сохраняется до смены данных и открывается после */
async function applyModSet(restart: boolean): Promise<ApplyReport> {
  modBusy = true; if (ui.open === 'mods') ui.render(true);
  try {
    let snap: any = null;
    if (restart) { const u = { hotbar: ui.hotbar, zoom: view.zoom }; if (sim) snap = await unpack((await sim.save(u)).str); else { snap = JSON.parse(JSON.stringify(serialize(game))); snap.ui = u; } }
    const pk = mods.enabled(), prio = mods.order();
    modSwap = true;
    const rep = applyMods(pk, prio, beta.VERSION);
    if (sim) await sim.mods(pk.map(p => p.files), prio, beta.VERSION);
    const spr: Record<string, any> = {};
    for (const [k, b] of Object.entries(spriteFiles(pk, rep))) { try { spr[k] = await createImageBitmap(new Blob([b as BlobPart], { type: 'image/png' })); } catch (e) { rep.warnings.push({ mod: rep.sprites[k].mod, file: rep.sprites[k].path, msg: 'PNG не читается: ' + (e as Error).message, warn: true }); } }
    setModArt(spr); R.resetArt(); mods.dirty = false; ui.modCount = rep.loaded.length;
    beta.log('info', `mods: ${rep.loaded.map(m => m.name + '@' + m.version).join(', ') || 'none'}; failed ${rep.failed.length}; warnings ${rep.warnings.length}; ${rep.ms.toFixed(1)} ms`);
    for (const f of rep.failed) for (const e of f.errors.slice(0, 5)) beta.log('warn', 'mod error: ' + errText(e));
    if (snap) { applyLoaded(snap, { force: true }); game.msg(rep.loaded.length ? `Симуляция перезапущена: модов ${rep.loaded.length}` : 'Симуляция перезапущена без модов'); }
    game.enqueue({ t: 'teleMods', ev: `apply ${rep.loaded.map(m => m.name + '@' + m.version).join(',') || '-'}${rep.failed.length ? ' failed ' + rep.failed.map(f => f.name).join(',') : ''}` });
    if (rep.failed.length) game.msg(`Моды с ошибками не загружены: ${rep.failed.map(f => f.title).join(', ')} — подробности: Esc → «Моды»`);
    return rep;
  } finally { modBusy = false; modSwap = false; }
}
const modsLine = () => { const r = lastApply(); return r && (r.loaded.length || r.failed.length) ? `\nмоды: ${r.loaded.map(m => m.name + ' ' + m.version).join(', ') || 'нет'}${r.failed.length ? ` · с ошибками ${r.failed.length}` : ''} · применены за ${r.ms.toFixed(1)} мс · спрайтов ${modSpriteCount()}` : ''; };

const saveString = async () => sim ? (await sim.save({ hotbar: ui.hotbar, zoom: view.zoom })).str : await pack(serialize(game));
const simTele = (): Promise<any> => sim ? sim.teleReport() : Promise.resolve(teleReport(game));
const clientInfo = () => beta.clientPart({ renderer: R.mode, rendererNote: R.modeNote, worker: !!sim, settings, gpu: gpuName() });
const ui = new UI({
  teleReport: simTele,
  statsView: (t, tab, sel) => sim ? sim.statsView(t, tab, sel) : Promise.resolve(statsView(game, t, tab, 40, sel)),
  exportTele: async () => { const r = await simTele(); beta.download(`zavod7-playtest-${r.seed}-${beta.stamp()}.json`, JSON.stringify(beta.teleFile(r, clientInfo()), null, 1)); },
  setTele: on => game.enqueue({ t: 'tele', on }),
  bugReport: async (desc, withSave) => {
    let save: string | null = null; if (withSave) try { save = await saveString(); } catch (e) { beta.log('error', 'save for report failed: ' + (e as Error).message); }
    let simr: any = null; try { simr = await simTele(); } catch { /* партия недоступна */ }
    return beta.bugReport({ desc, client: clientInfo(), sim: simr, save, workerErrors: sim ? sim.errors : [] });
  },
  saveBug: text => beta.download(`zavod7-bug-${beta.stamp()}.txt`, text, 'text/plain'),
  loadSaveString: async str => { applyLoaded(await unpack(beta.extractSave(str))); },
  errors: () => beta.errorCount,
  openBench: () => { const u = location.href.replace(/[?#].*$/, '') + '?bench=1' + (/[?&]render=\w+/.exec(location.search)?.[0].replace('?', '&') || ''); if (!window.open(u, '_blank')) location.href = u; },
  bench: () => benchState,
  saveBench: () => { const f = benchState.file; if (f) beta.download(`zavod7-gpubench-${beta.stamp()}.json`, JSON.stringify(f, null, 1)); },
  copyBench: async () => { const f = benchState.file; if (!f) return false; try { await navigator.clipboard.writeText(JSON.stringify(f)); game.msg('Результат замера скопирован'); return true; } catch { return false; } },
  feedback: () => typeof __FEEDBACK__ !== 'undefined' ? __FEEDBACK__ : '',
  setTex: n => { setTexQuality(n); settings.gfx = matchPreset(settings, n); settings.gfxAuto = false; saveSettings(settings); loadTextures(); },
  setPreset: p => { Object.assign(settings, presetSettings(p), { gfxAuto: false }); const texChanged = texQuality() !== PRESETS[p].tex; if (texChanged) setTexQuality(PRESETS[p].tex); applySettings(); saveSettings(settings); if (texChanged) loadTextures(); beta.log('info', `graphics preset: ${p}`); },
  isMac: () => IS_MAC, togglePollution: () => { view.pollution = !view.pollution; }, pollution: () => !!view.pollution,
  getGame: () => game, setCursor: i => { if (i) { view.bp = null; view.tool = null; } view.cursor = i; }, cursor: () => view.cursor,
  takeBp: bp => takeBp(bp), curBp: () => view.bp || lastBp, setTool: t => setTool(t),
  save: async s => { await saveTo(s); if (ui.open === 'menu') ui.render(true); }, load: s => loadFrom(s), newGame, listSaves, deleteSave: s => { deleteSave(s); },
  voiceInfo: () => voice.engineName(), voiceList: () => voice.voices().map(v => v.name), voiceTest: () => { audio.ensure(); voice.unlock(); voice.say(tr('ОСКАР: Связь установлена. Голос работает, инженер.'), 'oscar', true); },
  exportSave: async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([sim ? (await sim.save({ hotbar: ui.hotbar, zoom: view.zoom })).str : await pack(serialize(game))])); a.download = `zavod7-${game.seed}-${game.tick}.z7save`; a.click(); },
  getSettings: () => settings, setSettings: (p: Partial<Settings>) => { Object.assign(settings, p); if (['resScale', 'dprMax', 'fpsCap', 'detail', 'smoke', 'dayNight'].some(k => k in p)) settings.gfxAuto = false; applySettings(); saveSettings(settings); }, storageInfo: () => storageInfo, workerActive: () => !!sim, rendererMode: () => R.mode, rendererNote: () => R.modeNote, setRenderer: (m: 'auto' | 'webgl' | 'canvas') => { settings.renderer = m; saveSettings(settings); return R.setMode(m); },
  importSave: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.z7save,.txt'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; try { applyLoaded(await unpack(beta.extractSave(await f.text()))); } catch (e) { alert(tr('Файл повреждён') + ': ' + (e as Error).message); } }; i.click(); },
});

// ---------- v1.12: совместная игра (только в режиме Worker) ----------
const mp = sim ? new MpClient(sim, () => ({ name: settings.mpName || tr('Инженер'), color: settings.mpColor, server: settings.mpServer, ice: settings.mpIce, relay: /[?&]relay=1/.test(location.search) })) : null;
const mpui = mp ? new MpUI({ mp, game: () => game, settings: () => settings, setSettings: p => { Object.assign(settings, p); saveSettings(settings); }, render: () => ui.render(true), close: () => ui.close(), toggle: w => ui.toggle(w as any), open: () => ui.open, msg: t => game.msg(t), download: (n, t) => beta.download(n, t), sound: k => audio.play(k) }) : null;
ui.ext = { html: w => mpui ? mpui.html(w) : `<div class="panel"><div class="title">Совместная игра <span class="x" data-act="close">✕</span></div><div>Совместная игра работает только с симуляцией в отдельном потоке: Esc → Настройки → «Симуляция в Worker».</div></div>`,
  act: (a, el) => { if (!mpui) { if (a === 'mpopen') { ui.toggle('mp'); return true; } return false; } return mpui.act(a, el); }, inGame: () => !!mp?.inGame };
ui.mods = new ModsUI({
  store: mods, report: () => lastApply(), busy: () => modBusy, game: beta.VERSION,
  apply: async () => { if (mp?.inGame) { game.msg('В совместной игре моды не меняются — сначала выйдите'); return; } await applyModSet(true); if (ui.open !== 'mods') ui.toggle('mods'); else ui.render(true); },
  download: (n, b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/zip' })); a.download = n; a.click(); game.enqueue({ t: 'teleMods', ev: 'export ' + mods.enabled().length }); },
  msg: t => game.msg(t), render: () => ui.render(true), close: () => ui.close(),
  pending: () => pendingLoad,
  resolve: how => {
    const p = pendingLoad; pendingLoad = null; if (!p) { ui.close(); return; }
    beta.log('info', 'load with other mods: ' + how);
    if (how === 'cancel') { ui.close(); return; }
    if (how === 'without') { try { applyLoaded(p.data, { force: true }); } catch (e) { alert(tr('Не удалось загрузить') + ': ' + (e as Error).message); } game.enqueue({ t: 'teleMods', ev: 'load-without ' + p.diff.need.map(n => n.ref.name).join(',') }); return; }
    mods.enableExactly(p.data.mods || []).then(async miss => { await applyModSet(false); applyLoaded(p.data, { force: true }); if (miss.length) game.msg(`Не установлены моды: ${miss.join(', ')} — их постройки убраны`); game.enqueue({ t: 'teleMods', ev: 'load-enable ' + p.diff.need.map(n => n.ref.name).join(',') }); });
  },
});
let mpSig = '', mpWasGame = false;
if (mp) mp.onEvent = (e, d) => {
  const s = mp.session;
  const sig = `${s?.state}|${s?.isHost}|${mp.mode}|${mp.invite.length}|${mp.answer.length}|${!!mp.err}`; if (sig !== mpSig) { mpSig = sig; if (ui.open === 'mp') ui.render(true); }
  switch (e) {
    case 'start': mpWasGame = true; beta.log('info', `mp start: ${s?.players.length} players, me ${s?.me}`); ui.close(); view.cursor = null; takeBp(null); setTool(null); seenRockets = 1e9; setTimeout(() => { seenRockets = game.rockets; game.msg(`Совместная игра: игроков ${s?.players.length}. Чат — ${keyName(K('chat'))}, игроки — ${keyName(K('players'))}`); }, 500); break;
    case 'closed': if (mpWasGame) { mpui!.lost(String(d || 'Связь с хостом потеряна')); game.msg(String(d || 'Совместная игра завершена')); } mpWasGame = false; beta.log('info', 'mp closed: ' + d); if (ui.open === 'players') ui.close(); break;
    case 'desync': beta.log('warn', `mp desync at tick ${d?.t}, player ${d?.i}`); if (s?.isHost) game.enqueue({ t: 'teleMp', ev: 'desync' }); break;
    case 'resync': game.msg('Состояние сверено с хостом'); break;
    case 'report': game.msg('Отчёт о рассинхроне готов: Tab → «Скачать отчёт»'); break;
    case 'drop': if (s) game.msg(`Игрок ${s.players[d]?.name || d} отключился — его персонаж стоит`); break;
    case 'pause': game.msg(d ? 'Хост поставил паузу' : 'Хост продолжил игру'); break;
  }
};
window.addEventListener('beforeunload', () => { if (mp?.active) mp.close(true); });
const markMod = (ev: MouseEvent) => { const k = K('mark'); return k === 'AltLeft' || k === 'AltRight' ? ev.altKey : keys.has(k); };

// ---------- ввод ----------
function mouseTile(): [number, number] { const dpr = R.pixelRatio(); const [wx, wy] = R.screenToWorld(view.mouseX * dpr, view.mouseY * dpr); return [wx, wy]; }
function ghostPos(): [number, number] | null {
  if (!view.cursor) return null; const pid = ITEMS[view.cursor]?.place; if (!pid) return null;
  const p = PROTOS[pid]; const [wx, wy] = mouseTile();
  if (p.type === 'signal') { // v1.8: светофор — к ближайшему узлу путей, справа по ходу поезда (направление выбирается само)
    const G = railGraph(game); let best: [number, number, number] | null = null, bd = 3.2;
    for (let y = (Math.floor(wy) & ~1) - 4; y <= wy + 4; y += 2) for (let x = (Math.floor(wx) & ~1) - 4; x <= wx + 4; x += 2) for (let h = 0; h < 8; h++) {
      if (!G.nodes.has(nk(x, y, h))) continue; const cx = x + SIG_OX[h], cy = y + SIG_OY[h]; const d = Math.hypot(cx + .5 - wx, cy + .5 - wy); if (d < bd) { bd = d; best = [cx, cy, h]; } }
    if (best) { view.rot = best[2]; return [best[0], best[1]]; }
    return [Math.floor(wx), Math.floor(wy)];
  }
  if (p.type === 'rail') { const s = shapeOf(pid, view.rot); const ax = Math.round((wx - s.w / 2 + s.ox) / 2) * 2, ay = Math.round((wy - s.h / 2 + s.oy) / 2) * 2; return [ax - s.ox, ay - s.oy]; }
  const w = view.rot % 2 ? p.h : p.w, h = view.rot % 2 ? p.w : p.h;
  return [Math.floor(wx - w / 2 + 0.5), Math.floor(wy - h / 2 + 0.5)];
}
// ---------- v1.7: железная дорога — «тянуть путь» и вагоны на рельсы ----------
const CAR_ITEMS: Record<string, boolean> = { locomotive: true, 'cargo-wagon': true, 'fluid-wagon': true };
let railDrag: { sx: number; sy: number; sh: number; moved: boolean; tx: number; ty: number; plan: { pieces: (PlanPiece & { have?: boolean })[]; exact: boolean; ex: number; ey: number } | null } | null = null;
const railFree = (x: number, y: number) => game.world.terrain(x, y) < T_SHALLOW && game.world.occ(x, y) < 0;
const railHas = (p: PlanPiece) => { const s = shapeOf(p.proto, p.dir); const a = game.railCells.get(((p.x + s.ox + s.cells[0][0]) + 65536) * 131072 + (p.y + s.oy + s.cells[0][1] + 65536)); if (a) for (const id of a) { const e = game.ents.get(id); if (e && e.proto === p.proto && e.x === p.x && e.y === p.y && e.dir === p.dir) return true; } return false; };
/** начало пути: ближайший свободный конец рельса рядом с курсором (продолжение) или узел под курсором */
function railStart(wx: number, wy: number): [number, number, number] {
  let best: [number, number, number] | null = null, bd = 3;
  for (let y = Math.floor(wy) - 3; y <= Math.floor(wy) + 3; y++) for (let x = Math.floor(wx) - 3; x <= Math.floor(wx) + 3; x++) for (const id of game.railCells.get((x + 65536) * 131072 + (y + 65536)) || []) {
    const e = game.ents.get(id); if (!e) continue; for (const en of railEnds(e)) { const d = Math.hypot(en[0] - wx, en[1] - wy); if (d < bd) { bd = d; best = en; } } }
  return best || [Math.round(wx / 2) * 2, Math.round(wy / 2) * 2, -1];
}
function railPlanTo(wx: number, wy: number) {
  const d = railDrag!; let tx = Math.round(wx / 2) * 2, ty = Math.round(wy / 2) * 2;
  const L = Math.hypot(tx - d.sx, ty - d.sy); if (L > 160) { tx = d.sx + Math.round((tx - d.sx) * 160 / L / 2) * 2; ty = d.sy + Math.round((ty - d.sy) * 160 / L / 2) * 2; }
  if (tx === d.tx && ty === d.ty && d.plan) return; d.tx = tx; d.ty = ty;
  if (!d.moved && Math.hypot(tx - d.sx, ty - d.sy) < 4) { d.plan = null; return; }
  d.moved = true; const r = planRail(d.sx, d.sy, d.sh, tx, ty, -1, railFree, railHas, 30000);
  d.plan = { pieces: r.pieces.map(p => ({ ...p, have: railHas(p) })), exact: r.exact, ex: r.ex, ey: r.ey };
}
/** вагон под курсором: рельс, точка оси и направление (R — развернуть) */
function carSpot(): { rail: number; x: number; y: number; dx: number; dy: number } | null {
  const [wx, wy] = mouseTile(); const r = railAt(game, Math.floor(wx), Math.floor(wy), wx, wy); if (!r) return null;
  const s = shapeOf(r.proto, r.dir), ax = r.x + s.ox, ay = r.y + s.oy; let bd = Infinity, bp: [number, number, number] = [0, 0, 0];
  for (let d = 0; d <= s.len; d += 100) { const p = pointOn(s, d); const q = Math.hypot(ax + p[0] - wx, ay + p[1] - wy); if (q < bd) { bd = q; bp = p; } }
  const back = view.rot % 4 >= 2; const dx = Math.cos(bp[2]) * (back ? -1 : 1), dy = Math.sin(bp[2]) * (back ? -1 : 1);
  return { rail: r.id, x: ax + bp[0], y: ay + bp[1], dx, dy };
}
function bpPos(): [number, number] | null {
  if (!view.bp) return null; const [wx, wy] = mouseTile();
  return [Math.floor(wx - view.bp.w / 2 + 0.5), Math.floor(wy - view.bp.h / 2 + 0.5)];
}
function pasteAt(p: [number, number]) { game.enqueue({ t: 'paste', bp: view.bp!, x: p[0], y: p[1] }); lastPaste = p; }
function finishSel(cancel: boolean) {
  const s = view.sel; if (!s || !view.tool) return; view.sel = null;
  const x0 = Math.min(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), x1 = Math.max(s.x0, s.x1), y1 = Math.max(s.y0, s.y1);
  const t = view.tool;
  if (t === 'copy' || t === 'cut') {
    if (cancel) return;
    const bp = makeBlueprint(game, x0, y0, x1, y1, `Чертёж ${ui.bpLib().length + 1}`);
    if (!bp) { game.msg('В рамке нет построек'); return; }
    ui.addBp(bp); takeBp(bp);
    if (t === 'cut') game.enqueue({ t: 'decon', x0, y0, x1, y1, filter: 'all', trees: false });
    game.msg(`Чертёж: ${bp.entities.length} построек ${bp.w}×${bp.h}. ЛКМ — вставить, R — повернуть, F/G — отразить, Q — убрать`);
  } else if (t === 'decon') game.enqueue({ t: 'decon', x0, y0, x1, y1, filter: ui.deconFilter, trees: ui.deconTrees, cancel });
  else if (t === 'cancel') { if (!cancel) game.enqueue({ t: 'cancelGhosts', x0, y0, x1, y1 }); }
  else game.enqueue({ t: 'upgrade', x0, y0, x1, y1, map: ui.upgradeMap(), cancel });
}
// v1.2: быстрая погрузка/разгрузка — Ctrl+ЛКМ / Ctrl+ПКМ (на macOS с «Ctrl+щелчок = ПКМ» — Cmd), протягиванием — по всем постройкам
const quickMod = (e: MouseEvent) => e.metaKey || (e.ctrlKey && !(IS_MAC && settings.ctrlClick));
let quickDrag: { op: 'load' | 'unload'; seen: Set<number> } | null = null;
function quickAt(id: number, op: 'load' | 'unload', quiet: boolean) { game.enqueue({ t: 'quick', id, op, item: op === 'load' && view.cursor && !game.held ? view.cursor : undefined, quiet }); }
// стопка в руке: значок у курсора
const heldEl = document.createElement('div'); heldEl.id = 'held'; heldEl.style.cssText = 'position:fixed;pointer-events:none;z-index:50;display:none;width:36px;height:36px'; document.body.appendChild(heldEl);
let heldSig = '';
function drawHeld() {
  const h = game.held; const sig = h ? h.item + ':' + h.count : '';
  if (sig !== heldSig) { heldSig = sig; heldEl.innerHTML = h ? `<div class="slot" style="width:36px;height:36px;opacity:.92"><img src="${iconURL(h.item)}"><span class="cnt">${h.count}</span></div>` : ''; heldEl.style.display = h ? 'block' : 'none'; heldEl.dataset.item = h ? h.item : ''; heldEl.dataset.count = h ? String(h.count) : ''; }
  if (h) { heldEl.style.left = (view.mouseX + 10) + 'px'; heldEl.style.top = (view.mouseY + 10) + 'px'; }
}
function tryBuildAt(x: number, y: number, quiet: boolean) {
  const pid = ITEMS[view.cursor!]?.place; if (!pid) return;
  game.enqueue({ t: 'build', proto: pid, x, y, dir: view.rot as Dir, quiet });
}
function onDragTo(gx: number, gy: number) {
  if (!drag || !view.cursor) return;
  const pid = ITEMS[view.cursor].place!; const p = PROTOS[pid]; const isBelt = p.type === 'belt';
  const step = Math.max(p.w, p.h);
  while (drag.x !== gx || drag.y !== gy) {
    const dx = gx - drag.x, dy = gy - drag.y;
    if (Math.abs(dx) < step && Math.abs(dy) < step) { if (!isBelt) return; }
    let d: number;
    if (Math.abs(dx) >= Math.abs(dy)) d = dx > 0 ? 1 : 3; else d = dy > 0 ? 2 : 0;
    const k = isBelt ? 1 : step;
    const nx = drag.x + [0, k, 0, -k][d], ny = drag.y + [-k, 0, k, 0][d];
    if (isBelt && d !== view.rot) { game.enqueue({ t: 'setDirAt', x: drag.x, y: drag.y, dir: d as Dir }); view.rot = d; }
    drag.x = nx; drag.y = ny; tryBuildAt(nx, ny, true);
    if (!isBelt && (Math.abs(gx - drag.x) < step && Math.abs(gy - drag.y) < step)) return;
  }
}
// v1.4: кисть покрытий — ЛКМ кладёт (Shift — только призраки для роботов), ПКМ снимает; протягивание красит полосу
let floorDrag: { rm: boolean; ghost: boolean; x: number; y: number } | null = null;
function floorAt(bx: number, by: number, rm: boolean, ghost: boolean) {
  const n = view.brush || 1;
  if (rm) game.enqueue({ t: 'unfloor', x: bx, y: by, size: n }); else game.enqueue({ t: 'floor', x: bx, y: by, size: n, item: view.cursor!, ghost });
}
function floorPaint() {
  if (!floorDrag) return; const [wx, wy] = mouseTile(); const n = view.brush || 1; const [bx, by] = brushOrigin(wx, wy, n);
  const dx = bx - floorDrag.x, dy = by - floorDrag.y; if (!dx && !dy) return;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / n); // без пропусков при быстром движении мыши
  for (let i = 1; i <= steps; i++) floorAt(Math.round(floorDrag.x + dx * i / steps), Math.round(floorDrag.y + dy * i / steps), floorDrag.rm, floorDrag.ghost);
  floorDrag.x = bx; floorDrag.y = by;
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousemove', e => {
  view.mouseX = e.clientX; view.mouseY = e.clientY; view.mouseIn = true;
  if (railDrag) { const [wx, wy] = mouseTile(); railPlanTo(wx, wy); }
  else if (lmb && drag) { const g = ghostPos(); if (g) onDragTo(g[0], g[1]); }
  if (floorDrag) floorPaint();
  if (view.sel) { const [wx, wy] = mouseTile(); view.sel.x1 = Math.floor(wx); view.sel.y1 = Math.floor(wy); }
  if (quickDrag) { const [wx, wy] = mouseTile(); const en = game.entAt(Math.floor(wx), Math.floor(wy)); if (en && !quickDrag.seen.has(en.id)) { quickDrag.seen.add(en.id); quickAt(en.id, quickDrag.op, true); } }
  drawHeld();
  if (lmb && view.bp && lastPaste) { // протягивание чертежа: вставка вдоль оси с шагом его размера
    const p = bpPos()!; const dx = p[0] - lastPaste[0], dy = p[1] - lastPaste[1];
    if (Math.abs(dx) >= view.bp.w && Math.abs(dx) >= Math.abs(dy)) pasteAt([lastPaste[0] + Math.sign(dx) * view.bp.w, lastPaste[1]]);
    else if (Math.abs(dy) >= view.bp.h && Math.abs(dy) > Math.abs(dx)) pasteAt([lastPaste[0], lastPaste[1] + Math.sign(dy) * view.bp.h]);
  }
});
canvas.addEventListener('mouseleave', () => { view.mouseIn = false; });
// macOS: Ctrl+щелчок (и щелчок с зажатым Ctrl на тачпаде) — это правая кнопка; браузер присылает button 0 + ctrlKey
let ctrlRmb = false;
const btnOf = (e: MouseEvent) => (IS_MAC && settings.ctrlClick && e.button === 0 && e.ctrlKey && !e.metaKey) ? 2 : e.button;
canvas.addEventListener('mousedown', ev => {
  audio.ensure();
  const b = btnOf(ev); ctrlRmb = b !== ev.button;
  const e = { button: b, shiftKey: ev.shiftKey, clientX: ev.clientX, clientY: ev.clientY };
  view.mouseX = e.clientX; view.mouseY = e.clientY;
  const [wx, wy] = mouseTile(); const tx = Math.floor(wx), ty = Math.floor(wy); const ent = game.entAt(tx, ty);
  if (mp?.inGame && b === 0 && markMod(ev)) { game.enqueue({ t: 'mark', x: wx, y: wy }); altCombo = true; return; }
  if (view.tool && (e.button === 0 || e.button === 2 && (view.tool === 'decon' || view.tool === 'upgrade'))) { view.sel = { x0: tx, y0: ty, x1: tx, y1: ty, cancel: e.button === 2 }; return; }
  if (view.bp) { if (e.button === 0) { lmb = true; pasteAt(bpPos()!); } else if (e.button === 2) takeBp(null); return; }
  if (quickMod(ev) && ent && (e.button === 0 || e.button === 2)) { const op = e.button === 0 ? 'load' : 'unload'; quickAt(ent.id, op, false); quickDrag = { op, seen: new Set([ent.id]) }; return; }
  if (game.held && ent && (e.button === 0 || e.button === 2)) { game.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: ent.id, n: e.button === 2 ? 'one' : 'all' }); return; }
  if (e.button === 0 && e.shiftKey && !ent && !view.cursor && game.ghostAt(tx, ty)) { game.enqueue({ t: 'robotPrio', x: tx, y: ty }); return; }
  // v1.5: провод в руке — ЛКМ по первой и второй постройке соединяет (повторно — разрывает), ПКМ — отменить начатый провод
  if (view.cursor && WIRE_OF[view.cursor] != null && (e.button === 0 || e.button === 2)) {
    if (e.button === 2) { view.wireFrom = null; return; }
    if (!ent || !circuitCapable(ent)) { game.msg('Провод подключается к столбу, сундуку, конвейеру, манипулятору, цистерне, насосу, буру, лампе, робопорту, лаборатории, сборщику и комбинаторам'); return; }
    // v1.6: у арифметического и логического комбинатора две клеммы — вход (задняя клетка) и выход (передняя)
    const term = termAt(ent, tx, ty); const from = view.wireFrom != null ? game.ents.get(view.wireFrom) : null;
    if (!from || from.id === ent.id && (view.wireFromT || 0) === term) { view.wireFrom = from ? null : ent.id; view.wireFromT = term; return; }
    game.enqueue({ t: 'cwire', a: from.id, b: ent.id, c: WIRE_OF[view.cursor], ta: view.wireFromT || 0, tb: term }); view.wireFrom = ent.id; view.wireFromT = term; return;
  }
  if (view.cursor && FLOOR_BY_ITEM[view.cursor] && (e.button === 0 || e.button === 2)) {
    const n = view.brush || 1; const [bx, by] = brushOrigin(wx, wy, n); const rm = e.button === 2;
    if (!rm && !e.shiftKey && !game.inv.count(view.cursor)) game.msg('Нет предмета: ' + ITEMS[view.cursor].name + ' — поставлены призраки покрытия');
    floorDrag = { rm, ghost: e.shiftKey, x: bx, y: by }; floorAt(bx, by, rm, e.shiftKey); return;
  }
  if (e.button === 0) {
    if (e.shiftKey && ent && copiedCC && ent.t === copiedCC.t && ent.t !== 'assembler') { game.enqueue({ t: 'cset', id: ent.id, cc: copiedCC.cc }); game.msg('Настройки вставлены'); return; }
    if (e.shiftKey && ent && ent.t === 'assembler') { if (copiedRecipe !== null) game.enqueue({ t: 'setRecipe', id: ent.id, recipe: copiedRecipe }); if (copiedCC?.t === 'assembler') game.enqueue({ t: 'cset', id: ent.id, cc: copiedCC.cc }); return; }
    if (view.cursor === 'repair-pack') { lmb = true; return; }
    if (view.cursor && CAR_ITEMS[view.cursor]) { // v1.7: локомотив / вагон — на рельсы под курсором
      const q = carSpot(); if (!q) { game.msg('Ставится на рельсы'); return; }
      if (!game.inv.count(view.cursor)) { game.msg('Нет предмета: ' + ITEMS[view.cursor].name); return; }
      game.enqueue({ t: 'placeCar', proto: view.cursor, rail: q.rail, x: q.x, y: q.y, back: view.rot % 4 >= 2 }); return;
    }
    if (view.cursor && isRailProto(ITEMS[view.cursor]?.place || '')) { // v1.7: щелчок — один кусок, протягивание — путь
      const [sx, sy, sh] = railStart(wx, wy); railDrag = { sx, sy, sh, moved: false, tx: NaN, ty: NaN, plan: null }; lmb = true; return;
    }
    if (view.cursor) {
      if (!game.inv.count(view.cursor)) { game.msg('Нет предмета: ' + ITEMS[view.cursor].name); }
      lmb = true; const g = ghostPos()!; drag = { x: g[0], y: g[1], dir: view.rot, placed: true }; tryBuildAt(g[0], g[1], false); return;
    }
    const car = !ent && game.trains.length ? carNear(game, wx, wy) : null;
    if (ent) ui.toggle('ent', ent.id);
    else if (car) ui.toggle('ent', car.id);
    else if (view.hoverWire != null && view.hoverWire >= 0) { const w = game.cw[view.hoverWire]; if (w) ui.openNet(w[0], wt(w, 0), w[2]); }
    lmb = true;
  } else if (e.button === 2) {
    if (e.shiftKey && ent && (hasOut(ent) || ent.t === 'combinator')) { copiedCC = { t: ent.t, cc: JSON.parse(JSON.stringify(ent.cc || {})) }; game.msg('Настройки комбинатора скопированы'); return; }
    if (e.shiftKey && ent && ent.t === 'assembler') { copiedRecipe = ent.recipe || null; copiedCC = ent.cc ? { t: 'assembler', cc: cleanCC(ent, ent.cc) || {} } : null; game.msg('Рецепт скопирован'); return; }
    rmb = true;
  }
});
window.addEventListener('mouseup', ev => { if (railDrag && ev.button === 0) { const d = railDrag; railDrag = null;
    if (d.plan && d.plan.pieces.length) { const pcs = d.plan.pieces.filter(p => !p.have).map(p => ({ proto: p.proto, x: p.x, y: p.y, dir: p.dir })); if (pcs.length) game.enqueue({ t: 'railPath', pieces: pcs, ghost: ev.shiftKey || undefined }); else game.msg('Путь уже уложен'); }
    else if (!d.moved) { const g = ghostPos(); if (g) { if (!game.inv.count(view.cursor!)) game.msg('Нет предмета: ' + ITEMS[view.cursor!].name); tryBuildAt(g[0], g[1], false); } } }
  floorDrag = null; const e = { button: ev.button === 0 && ctrlRmb ? 2 : ev.button }; if (ev.button === 0) ctrlRmb = false; if (view.sel && (e.button === 0) === !view.sel.cancel) finishSel(!!view.sel.cancel); if (e.button === 0) { lmb = false; drag = null; lastPaste = view.bp ? null : lastPaste; } if (e.button === 2) rmb = false; quickDrag = null; });
// колесо мыши — шаг 12% на щелчок; тачпад (прокрутка двумя пальцами и щипок) — плавно; щипок в Safari — жестами
const gestureActive = installGestures(canvas, () => view.zoom, z => { view.zoom = z; });
canvas.addEventListener('wheel', e => { e.preventDefault(); if (gestureActive()) return; view.zoom = wheelZoom(view.zoom, e, settings.wheel); }, { passive: false });
window.addEventListener('keydown', e => {
  audio.ensure();
  if (ui.rebinding) { e.preventDefault(); if (e.code !== 'Escape') { for (const [act, c] of Object.entries(settings.keys)) if (c === e.code && act !== ui.rebinding) settings.keys[act] = ''; settings.keys[ui.rebinding] = e.code; saveSettings(settings); } ui.rebinding = null; ui.render(true); return; }
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
  const k = e.code;
  if (k === 'AltLeft' || k === 'AltRight') { e.preventDefault(); if (!e.repeat) { altHeld = true; altCombo = false; } return; }
  if (altHeld) altCombo = true;
  if (e.altKey && (k === 'KeyD' || k === 'KeyU')) { e.preventDefault(); setTool(k === 'KeyD' ? 'decon' : 'upgrade'); return; }
  if (e.ctrlKey || e.metaKey) {
    if (k === 'KeyC' || k === 'KeyX') { e.preventDefault(); setTool(k === 'KeyC' ? 'copy' : 'cut'); }
    else if (k === 'KeyV') { e.preventDefault(); const b = lastBp || ui.bpLib()[0]?.bp; if (b) takeBp(b); else game.msg('Нет чертежа — сначала Ctrl+C'); }
    else if (k === 'KeyZ') { e.preventDefault(); game.enqueue({ t: e.shiftKey ? 'redo' : 'undo' }); }
    else if (k === 'KeyY') { e.preventDefault(); game.enqueue({ t: 'redo' }); }
    return;
  }
  if (view.bp && (k === K('rotate') || k === K('pickup') || k === 'KeyG')) {
    view.bp = k === K('rotate') ? (e.shiftKey ? rotateBp(rotateBp(rotateBp(view.bp))) : rotateBp(view.bp)) : flipBp(view.bp, k === K('pickup')); lastBp = view.bp; return;
  }
  if (['F3', 'F9', 'Tab', 'Space', K('shoot'), K('pause'), K('debug')].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === K('players') && k) { e.preventDefault(); ui.toggle('players'); }
  else if (k === K('chat') && k && mp?.inGame) { e.preventDefault(); keys.clear(); mpui!.openChat(); }
  else if (k === K('inv')) ui.toggle('inv');
  else if (k === K('tech')) ui.toggle('tech');
  else if (k === K('stats')) ui.toggle('stats');
  else if (k === K('calc') && k) { if (ui.open === 'calc') ui.close(); else ui.openCalc(null, 0, 'key'); }
  else if (k === K('map')) ui.toggle('map');
  else if (k === K('bp')) ui.toggle('bp');
  else if (k === K('logi')) ui.toggle('logi');
  else if (k === K('trains') && k) ui.toggle('trains');
  else if (k === K('vehicle') && k) game.enqueue({ t: 'vehicle' });
  else if (k === 'Escape' && game.held) game.enqueue({ t: 'hand', op: 'return' });
  else if (k === 'Escape') { if (view.bp || view.tool) { takeBp(null); setTool(null); } else if (view.cursor) view.cursor = null; else if (ui.open) ui.close(); else ui.toggle('menu'); }
  else if (k === K('rotate')) {
    const [wx, wy] = mouseTile(); const ent = game.entAt(Math.floor(wx), Math.floor(wy));
    const n = view.cursor === 'curved-rail' ? 8 : 4; const car = !ent && game.trains.length ? carNear(game, wx, wy) : null;
    if (view.cursor) view.rot = (view.rot % n + (e.shiftKey ? n - 1 : 1)) % n; else if (ent) game.enqueue({ t: 'rotate', id: ent.id, rev: e.shiftKey }); else if (car) game.enqueue({ t: 'rotate', id: car.id });
  }
  else if (k === K('pipette')) {
    if (game.held) game.enqueue({ t: 'hand', op: 'return' });
    else if (view.bp || view.tool) { takeBp(null); setTool(null); }
    else if (view.cursor) view.cursor = null;
    else { const [wx, wy] = mouseTile(); const ent = game.entAt(Math.floor(wx), Math.floor(wy)); if (ent) { view.cursor = ent.proto; view.rot = ent.dir; } }
  }
  else if (k === K('pickup')) game.enqueue({ t: 'pickup' });
  else if (k === K('pollution')) { view.pollution = !view.pollution; game.msg(view.pollution ? 'Слой загрязнения: вкл' : 'Слой загрязнения: выкл'); }
  else if (k === K('debug') && e.shiftKey) { profDetail = !profDetail; view.debug = true; if (sim) sim.post({ t: 'prof', detail: profDetail }); else game.prof.detail = profDetail; } // v1.9: Shift+F3 — замер по типам и чанкам
  else if (k === K('debug')) view.debug = !view.debug;
  else if (k === 'F8') { e.preventDefault(); ui.toggle('bug'); }
  else if ((k === K('pause') || k === 'Pause') && mp?.inGame) { const s = mp.session!; if (s.isHost) s.pause(!s.paused); else game.msg('Паузу ставит только хост'); }
  else if (k === K('pause') || k === 'Pause') { paused = !paused; sim?.post({ t: 'pause', paused }); game.msg(paused ? 'Пауза' : 'Продолжаем'); }
  else if (view.cursor && FLOOR_BY_ITEM[view.cursor] && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) {
    const up = k === 'Equal' || k === 'NumpadAdd'; view.brush = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, (view.brush || 1) + (up ? 1 : -1))); game.msg(`Кисть: ${view.brush}×${view.brush}`);
  }
  else if (view.debug && mp?.inGame && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) game.msg('Скорость в совместной игре не меняется');
  else if (view.debug && (k === 'Equal' || k === 'NumpadAdd')) { speed = Math.min(8, speed * 2); sim?.post({ t: 'speed', speed }); }
  else if (view.debug && (k === 'Minus' || k === 'NumpadSubtract')) { speed = Math.max(1, speed / 2); sim?.post({ t: 'speed', speed }); }
  else if (/^Digit\d$/.test(k)) { const d = +k.slice(5); ui.selectHot(d === 0 ? 9 : d - 1); }
});
document.addEventListener('mousedown', () => { if (altHeld) altCombo = true; }, true); // Alt+щелчок (фильтры вагона) — не переключает режим деталей
window.addEventListener('keyup', e => { keys.delete(e.code); if ((e.code === 'AltLeft' || e.code === 'AltRight') && altHeld) { altHeld = false; if (!altCombo) view.alt = !view.alt; e.preventDefault(); } });
window.addEventListener('blur', () => { keys.clear(); lmb = rmb = false; altHeld = false; view.sel = null; });

// ---------- цикл ----------
const TICK_MS = 1000 / 60;
let acc = 0, last = performance.now(), fps = 0, fpsAcc = 0, fpsN = 0, tickMs = 0;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
let started = false;
/** шаги симуляции за прошедшее время; вызывается из кадра или — во фоновой вкладке — из таймера Worker'а */
let lastInput = '';
function readInput(typing: boolean): Extract<Command, { t: 'input' }> {
  const mx = typing ? 0 : (keys.has(K('right')) ? 1 : 0) - (keys.has(K('left')) ? 1 : 0), my = typing ? 0 : (keys.has(K('down')) ? 1 : 0) - (keys.has(K('up')) ? 1 : 0);
  let mine: { x: number; y: number } | null = null;
  if (rmb) { const [wx, wy] = mouseTile(); mine = { x: Math.floor(wx), y: Math.floor(wy) }; }
  let shoot: { x: number; y: number } | null = null, repair: number | null = null;
  if (keys.has(K('shoot')) && !typing) { const [wx, wy] = mouseTile(); shoot = { x: wx, y: wy }; }
  if (lmb && view.cursor === 'repair-pack') { const [wx, wy] = mouseTile(); const en = game.entAt(Math.floor(wx), Math.floor(wy)); if (en) repair = en.id; }
  return { t: 'input', mx, my, mine, shoot, repair };
}
function simulate(now: number, hidden: boolean) {
  const dt = Math.min(250, now - last); last = now;
  if (!hidden) { fpsAcc += dt; fpsN++; if (fpsAcc > 500) { fps = fpsN * 1000 / fpsAcc; if (started) { beta.fpsSample(fps, tickMs); if (fpsWatch.sample(fps, fpsAcc, settings.gfx) && !ui.open) gfxHint(); } fpsAcc = 0; fpsN = 0; } }
  logMessages();
  if (sim) { // режим Worker: отправляем ввод и просим снимок для видимой области
    const inp = readInput(['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)); const sig = JSON.stringify(inp);
    if (sig !== lastInput) { lastInput = sig; sim.post({ t: 'cmd', c: inp }); }
    const s = R.s || 32, hw = (R.W || 2000) / 2 / s + 3, hh = (R.H || 1200) / 2 / s + 3; const [cx, cy] = sim.playerPos(now);
    sim.request({ x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }, [ui.open === 'ent' ? ui.entId : -1, view.hoverEnt?.id ?? -1, ui.open === 'cnet' && ui.net ? ui.net.id : -1, view.hoverWire != null && view.hoverWire >= 0 ? game.cw[view.hoverWire]?.[0] ?? -1 : -1].filter(x => x >= 0), ui.open === 'map', R.lod && view.zoom < LOD_ZOOM);
    tickMs = sim.tickMs; autosaveCheck(now); return;
  }
  if (!paused) acc += dt * speed;
  let n = 0; const t0 = performance.now();
  const typing = hidden || ['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName);
  while (acc >= TICK_MS) {
    const mx = typing ? 0 : (keys.has(K('right')) ? 1 : 0) - (keys.has(K('left')) ? 1 : 0), my = typing ? 0 : (keys.has(K('down')) ? 1 : 0) - (keys.has(K('up')) ? 1 : 0);
    let mine: { x: number; y: number } | null = null;
    if (rmb) { const [wx, wy] = mouseTile(); mine = { x: Math.floor(wx), y: Math.floor(wy) }; }
    let shoot: { x: number; y: number } | null = null, repair: number | null = null;
    if (keys.has(K('shoot')) && !typing) { const [wx, wy] = mouseTile(); shoot = { x: wx, y: wy }; }
    if (lmb && view.cursor === 'repair-pack') { const [wx, wy] = mouseTile(); const en = game.entAt(Math.floor(wx), Math.floor(wy)); if (en) repair = en.id; }
    game.enqueue({ t: 'input', mx, my, mine, shoot, repair });
    prevPX = game.player.x; prevPY = game.player.y;
    game.step(); acc -= TICK_MS; n++;
    if (n > 8 * speed) { acc = 0; break; } // отстаём — замедляем игру, а не «умираем»
  }
  if (n) tickMs = (performance.now() - t0) / n;
  autosaveCheck(now);
}
// фоновая вкладка: requestAnimationFrame не вызывается, а таймеры главного потока режутся до 1 Гц —
// таймер в Worker'е будит симуляцию 20 раз в секунду, завод продолжает работать
if (!sim) try {
  const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
  wk.onmessage = () => { if (started && document.hidden) { simulate(performance.now(), true); game.sfx.length = 0; } };
} catch { /* без Worker'а фон просто ставится на паузу */ }
// сообщения игры — в журнал отчёта об ошибке
const msgSeen = new Set<string>();
function logMessages() {
  const ms = game.messages; for (let i = Math.max(0, ms.length - 8); i < ms.length; i++) { const k = ms[i].tick + '|' + ms[i].text; if (!msgSeen.has(k)) { msgSeen.add(k); beta.log('game', `t${ms[i].tick} ${ms[i].text}`); } }
  if (msgSeen.size > 300) msgSeen.clear();
}
ui.onOpen = w => { if (w) beta.winOpened(w); if (w === 'menu') fillSlotInfo();
  if (w && settings.uiVoice === 'all') setTimeout(() => { const t = document.querySelector('#win .title'); if (t) voice.say((t.firstChild?.textContent || '').trim(), 'ui'); }, 0); };
ui.onHint = t => voice.say('ОСКАР: ' + tr(t.title) + '. ' + tr(t.text), 'oscar');
// «Озвучка интерфейса: всё» — подсказка под курсором (первая строка), когда курсор задержался
{ let lastTip = '', since = 0; setInterval(() => { if (settings.uiVoice !== 'all') return; const el = document.getElementById('tip')!; const t = el.style.display === 'none' ? '' : (el.innerText || '').split('\n')[0].trim();
  if (t !== lastTip) { lastTip = t; since = performance.now(); return; } if (t && since > 0 && performance.now() - since > 600) { since = -1; voice.say(t, 'ui'); } }, 200); }
{ const note = document.getElementById('bugnote'); if (note) { note.onclick = () => { note.style.display = 'none'; if (ui.open !== 'bug') ui.toggle('bug'); };
  beta.onError(() => { if (ui.open !== 'bug') { note.textContent = tr('⚠ Ошибка в игре — нажмите, чтобы составить отчёт (F8)'); note.style.display = 'block'; } }); } }
// ошибки клиента — в статистику партии (1.1: «падения на 100 ч игры»), не чаще раза в 2 с и не больше 50 за сессию
{ let last = -1e9, n = 0; beta.onError(e => { const now = performance.now(); if (now - last < 2000 || n >= 50) return; last = now; n++; game.enqueue({ t: 'teleErr', sig: beta.errSig(e.msg) }); }); }
let ambN = 0;
function ambientScan() {
  const P = game.player; let m = 0, b = 0, st = 0;
  for (const e of game.ents.values()) {
    const d = Math.hypot(e.x + e.w / 2 - P.x, e.y + e.h / 2 - P.y); if (d > 22) continue; const w = 1 / (1 + d * d / 60);
    if (e.t === 'belt' || e.t === 'underground' || e.t === 'splitter') { if (e.moving !== false && e.lanes && e.lanes.some(l => l[0].length + l[1].length)) b += w; }
    else if (e.status === 'working') { if (e.t === 'boiler' || e.t === 'engine') st += w; else if (e.t !== 'pole' && e.t !== 'solar' && e.t !== 'lamp' && e.t !== 'chest') m += w * (e.w * e.h > 4 ? 1.5 : .6); }
  }
  audio.ambient(m / 8, b / 25, st / 3);
}
function gfxHint() {
  const next: Record<string, Preset> = { high: 'medium', medium: 'low', low: 'min', custom: 'low', '': 'low' };
  const p = next[settings.gfx] || 'low';
  game.msg(`Низкий FPS (${fps.toFixed(0)}). Попробуйте графику «${PRESET_NAMES[p]}»: Esc → Настройки → Графика`); beta.log('info', `low fps hint: ${fps.toFixed(1)}, preset ${settings.gfx}`);
}
let lastDraw = 0;
/** время работы кадра в главном потоке (без ожидания GPU) — последние 256 кадров; для замеров «60 FPS» (раздел 19) */
const frameCost = new Float32Array(256); let frameN = 0;
function frame(now: number) {
  const fc0 = performance.now(); try { if (!modSwap) frameBody(now); } finally { frameCost[frameN++ & 255] = performance.now() - fc0; }
  requestAnimationFrame(frame);
}
function frameBody(now: number) {
  // ограничение FPS (слабые ПК, ноутбук от батареи): пропускаем кадр целиком, симуляция догонит по времени
  if (settings.fpsCap > 0 && now - lastDraw < 1000 / settings.fpsCap - 2) return;
  lastDraw = now;
  simulate(now, false);
  // звуки симуляции
  for (const s of game.sfx) { audio.play(s.k, s.x - game.player.x, s.y - game.player.y); if (s.k === 'boom' && settings.shake) shake = Math.max(shake, 10 / (1 + Math.hypot(s.x - game.player.x, s.y - game.player.y) / 4)); if (s.k === 'launch' && settings.shake) shake = Math.max(shake, 6); }
  game.sfx.length = 0;
  if (game.player.mining && R.frame % 22 === 0) audio.play('mine', game.player.mining.x - game.player.x, game.player.mining.y - game.player.y);
  if (++ambN % 15 === 0) ambientScan();
  const a = Math.min(1, acc / TICK_MS); const sp = sim ? sim.playerPos(now) : null;
  shake *= 0.9; const sk = shake > 0.3 ? shake / 48 : 0;
  const px = (sp ? sp[0] : prevPX + (game.player.x - prevPX) * a) + (Math.random() - .5) * sk, py = (sp ? sp[1] : prevPY + (game.player.y - prevPY) * a) + (Math.random() - .5) * sk;
  // наведение и призрак
  const [wx, wy] = mouseTile(); const tx = Math.floor(wx), ty = Math.floor(wy);
  view.hoverEnt = view.mouseIn ? game.entAt(tx, ty) : null;
  if (view.mouseIn && !view.hoverEnt && (game.trains.length || game.railCells.size)) view.hoverEnt = (game.trains.length ? carNear(game, wx, wy) : null) || (game.railCells.size ? railAt(game, tx, ty, wx, wy) : null); // v1.7
  view.hoverWire = view.mouseIn && !view.hoverEnt && !view.bp && !view.tool && game.cw.length ? wireAt(game, wx, wy) : -1; // v1.6: провод под курсором — значения сигналов
  view.ghostPos = ghostPos(); view.bpPos = bpPos();
  if (game.rockets > seenRockets) { if (seenRockets === 0) ui.toggle('victory'); seenRockets = game.rockets; }
  if (view.cursor && view.ghostPos) {
    const pid = ITEMS[view.cursor].place!;
    view.ghostOk = game.inv.count(view.cursor) ? game.canPlace(pid, view.ghostPos[0], view.ghostPos[1], view.rot) : { ok: false, reason: 'Нет предмета в инвентаре' };
  } else view.ghostOk = null;
  if (view.cursor !== 'curved-rail' && view.cursor !== 'rail-signal' && view.cursor !== 'rail-chain-signal' && view.rot > 3) view.rot %= 4;
  // v1.7: план пути и призрак вагона
  const rd = railDrag; view.railPlan = rd && rd.plan ? (() => { const P = rd.plan!; const nS = P.pieces.filter(p => !p.have && p.proto === 'straight-rail').length, nC = P.pieces.filter(p => !p.have && p.proto === 'curved-rail').length;
    const enough = game.inv.count('straight-rail') >= nS && game.inv.count('curved-rail') >= nC;
    return { pieces: P.pieces, start: [rd.sx, rd.sy] as [number, number], end: [P.ex, P.ey] as [number, number], ok: P.exact, label: tr(`рельсов ${nS} · кривых ${nC}`) + (enough ? '' : ' · ' + tr('не хватает — призраки для роботов')) + (P.exact ? '' : ' · ' + tr('путь не найден')) }; })() : null;
  view.carGhost = view.cursor && CAR_ITEMS[view.cursor] && view.mouseIn ? (() => { const q = carSpot(); if (!q) { const [mx, my] = mouseTile(); return { proto: view.cursor!, x: mx, y: my, dx: 0, dy: -1, ok: false, reason: 'Ставится на рельсы' }; } const has = game.inv.count(view.cursor!) > 0; return { proto: view.cursor!, x: q.x, y: q.y, dx: q.dx, dy: q.dy, ok: has, reason: has ? undefined : 'Нет предмета в инвентаре' }; })() : null;
  if (view.railPlan || view.carGhost) view.ghostPos = null;
  if (view.cursor && !ITEMS[view.cursor]?.place && !CAR_ITEMS[view.cursor] && view.cursor !== 'repair-pack' && !FLOOR_BY_ITEM[view.cursor] && WIRE_OF[view.cursor] == null) view.cursor = null;
  if (view.cursor === 'repair-pack' && !game.inv.count('repair-pack')) view.cursor = null;
  R.beltItems = sim ? sim.beltItems : null;
  view.zones = ui.open === 'ent' && game.ents.get(ui.entId)?.t === 'roboport';
  if (view.wireFrom != null && (!view.cursor || WIRE_OF[view.cursor] == null)) view.wireFrom = null;
  R.draw(game, view, px, py);
  drawHeld();
  if (thumbReq.length) { const u = R.thumbnail(THUMB_W, THUMB_H); for (const f of thumbReq.splice(0)) f(u); }
  if (R.frame % 10 === 0) voice.watch(game.messages, game.goalIdx, i => GOALS[i]?.text || null, game.tick);
  ui.hud(); mpui?.hud();
  ui.hoverInfo(view.hoverEnt, view.mouseIn ? [tx, ty] : null, view.hoverWire);
  ui.sampleNet();
  if (R.frame % 20 === 0) R.drawMap(game, minimap, game.player.x, game.player.y, 1, view.pollution);
  if (ui.open === 'map' && R.frame % 30 === 1) { const bm = document.getElementById('bigmap') as HTMLCanvasElement; if (bm) R.drawMap(game, bm, game.player.x, game.player.y, 2, view.pollution); }
  const dbg = document.getElementById('debug')!;
  if (view.debug) {
    let belts = 0, items = 0, stacks = 0; for (const e of game.ents.values()) if (e.lanes) { belts++; for (const s of e.lanes) for (const l of s) { items += l.length; for (const it of l) if (it.n > 1) stacks++; } }
    dbg.style.display = 'block';
    dbg.textContent = tr(`FPS ${fps.toFixed(0)} · тик ${tickMs.toFixed(2)} мс · ${sim ? `Worker, UPS ${sim.ups.toFixed(0)}` : 'главный поток'} ${sim ? ` · снимок ${sim.snapMs.toFixed(2)} мс в Worker, приём ${sim.applyMs.toFixed(2)} мс (целиком ${sim.nFull}, кратко ${sim.nDyn}, предметов ${sim.nItems})` : ''} · скорость ×${speed}${paused ? ' (пауза)' : ''}\nрендер ${R.mode} · средний слой ${R.stat.mid.toFixed(2)} мс · спрайтов ${R.stat.quads} · растеризовано ${R.stat.rast} (${R.stat.rastMs.toFixed(1)} мс) · вытеснений ${R.stat.evict}\nтик #${game.tick} · построек ${game.ents.size} · конвейеров ${belts} · предметов ${items} (стопок ${stacks}) · покрытий ${game.floors.size}${game.tileMarks.size ? ` (призраков ${game.tileMarks.size})` : ''}\nэлектросетей ${game.powerNets.size} · жидк. сетей ${game.fluidNets.length} · чанков ${game.world.chunks.size}\nюнитов ${game.units.length} · групп ${game.groups.length} · эволюция ${(game.evolution * 100).toFixed(2)}% · текстуры ${texQuality()}px\n${(() => { const rv = robotView(game, ITEM_IDX); return `роботов в полёте ${rv.buf.length / ROBOT_STRIDE} (логистических ${(() => { let k = 0; for (let i = 3; i < rv.buf.length; i += ROBOT_STRIDE) if (rv.buf[i] & 8) k++; return k; })()}, видно ${R.stat.robots}) · сетей робопортов ${rv.nets.length} · подсистема роботов ${rv.ms.toFixed(3)} мс`; })()}\nсетей сигналов ${sim ? game.cstat[0] : game.cnets.length} · проводов ${game.cw.length} · комбинаторов ${sim ? game.cstat[3] ?? 0 : game.ccombs.length} · подсистема схемотехники ${(sim ? game.cstat[2] : circuitsMs()).toFixed(3)} мс\nпоездов ${sim ? game.tstat[0] : game.trains.length} · рельсов ${(() => { let k = 0; for (const e of game.ents.values()) if (e.t === 'rail') k++; return k; })()} · подсистема поездов ${(sim ? game.tstat[1] : trainMs).toFixed(3)} мс · светофоров ${(() => { let k = 0; for (const e of game.ents.values()) if (e.t === 'signal') k++; return k; })()} · блоков ${railGraph(game).nblk} (резервов ${game.trains.reduce((a, t) => a + (t.res?.length || 0), 0)})${(() => { const v = game.mpv?.mp; if (!v || !mp?.session) return ''; const st = mp.session.stats(); return `\nсеть: игрок ${v.me + 1} из ${v.n} · пинг ${mp.session.ping()} мс · задержка ввода ${v.delay} тиков · запас кадров ${v.buf} · ожидание ${v.wait} мс (простоев ${v.stalls}) · пакетов ${st.sent} (повторов ${st.resent}) · ${(st.out / 1024).toFixed(0)}/${(st.inn / 1024).toFixed(0)} КБ · подсистема сети (контрольная сумма) ${v.hashMs.toFixed(3)} мс`; })()}${profText()}${modsLine()}\nигрок ${game.player.x.toFixed(1)}, ${game.player.y.toFixed(1)} · seed ${game.seed} · день ${(game.daylight() * 100).toFixed(0)}%`);
  } else dbg.style.display = 'none';
  canvas.style.cursor = view.cursor || view.tool || view.bp ? 'crosshair' : view.hoverEnt ? 'pointer' : 'default';
}
/** v1.9: строки профайлера F3 — подсистемы, группы, дорогие типы и чанки, спящие ленты, LOD */
function profText(): string {
  const p = game.prof.last; const lod = settings.lod && view.zoom < LOD_ZOOM;
  let s = `\nкарта издалека (LOD): ${lod ? 'вкл' : 'выкл'} · масштаб ${view.zoom.toFixed(2)}${sim ? ` · предметы на лентах ${(sim.itemBytes / 1024).toFixed(1)} КБ/кадр` : ''}`;
  if (!p) return s;
  const f = (x: number) => x.toFixed(3);
  s += `\nпрофайлер (среднее за ${p.ticks} тиков): тик ${f(p.total)} мс · ` + p.sub.filter(([, ms]) => ms >= 0.0005).map(([k, ms]) => `${SUB_NAMES[k] || k} ${f(ms)}`).join(' · ');
  s += `\nконвейеров ${p.belts} (спят ${p.sleeping}, ${p.belts ? Math.round(p.sleeping / p.belts * 100) : 0}%) · в списке тика ${p.listed} из ${p.ents} построек`;
  if (!p.detail) return s + '\nShift+F3 — замер по типам построек и чанкам';
  s += '\nпо группам: ' + p.groups.map(([k, ms]) => `${SUB_NAMES[k] || k} ${f(ms)}`).join(' · ');
  s += '\nдорогие типы: ' + p.types.slice(0, 8).map(([id, ms, n]) => `${ITEMS[id]?.name || id} ×${n} ${f(ms)}`).join(' · ');
  s += '\nтоп-10 самых дорогих чанков: ' + p.chunks.map(([cx, cy, ms, n]) => `[${cx},${cy}] ${n} шт ${f(ms)}`).join(' · ');
  return s;
}
// ---------- текстуры 2K: генерация с экраном загрузки ----------
async function loadTextures() {
  const N = texQuality(); const el = document.getElementById('loading')!; el.style.display = 'flex';
  const bar = el.querySelector('i') as HTMLElement, txt = el.querySelector('.lt') as HTMLElement;
  txt.textContent = tr(`Генерация текстур ${N}×${N}…`); const sub = el.querySelector('.small'); if (sub) sub.textContent = tr('Поверхность, вода, металл — процедурно, в фоновых потоках'); const lt = el.querySelector('.ltitle'); if (lt) lt.textContent = tr('ЗАВОД-7'); bar.style.width = '0%';
  const ms = await generateTextures(N, (d, t, name) => { bar.style.width = (d / t * 100).toFixed(0) + '%'; txt.textContent = tr(`Генерация текстур ${N}×${N}: ${d}/${t} (${name})`); });
  el.style.display = 'none'; console.log(`текстуры ${N}px за ${ms.toFixed(0)} мс`); (window as any).__texMs = ms;
}
// старт: продолжить последнее автосохранение или новая игра
(async () => {
  await loadTextures();
  applySettings();
  const moved = await store.migrateFromLocal(Object.keys(getMeta())).catch(() => 0);
  if (moved) console.log('сохранений перенесено в IndexedDB:', moved);
  refreshStorageInfo();
  // v1.10: моды из IndexedDB — до загрузки партии (данные игры должны совпасть с сохранением)
  try { await mods.init(); if (mods.enabled().length && !BENCH) await applyModSet(false); else mods.dirty = false; } catch (e) { beta.log('error', 'mods: ' + (e as Error).message); }
  for (const id of ['win', 'hotbar']) document.getElementById(id)!.addEventListener('mousedown', ev => { audio.ensure(); if ((ev.target as HTMLElement).closest('[data-act],[data-h],button')) audio.play('ui'); });
  const saves = listSaves().sort((a, b) => b.time - a.time);
  // «Что нового» — один раз после обновления (не при первом запуске: там обучение)
  const SEEN = 'zavod7:seenVersion'; let seen: string | null = null; try { seen = localStorage.getItem(SEEN); localStorage.setItem(SEEN, beta.VERSION); } catch { /* без хранилища */ }
  if (BENCH) { /* эталонная база загрузится ниже */ }
  else if (saves.length) { if (await loadFrom(saves[0].slot)) { game.msg('Продолжаем последнюю игру. Esc — меню.'); if (seen !== beta.VERSION) ui.toggle('news'); } }
  else { if (sim) { sim.newGame(Math.floor(Math.random() * 1e9), 'normal'); game = sim.g; } else if (activeMods().length) game = new Game(Math.floor(Math.random() * 1e9)); intro(); ui.toggle(seen && seen !== beta.VERSION ? 'news' : 'help'); }
  if (gfxFirst && gfxFirst.why[0] !== '?gfx' && gfxFirst.preset !== 'high') game.msg(`Графика «${PRESET_NAMES[gfxFirst.preset]}» — подобрана под этот компьютер (${gfxFirst.why.join(', ')}). Изменить: Esc → Настройки`);
  prevPX = game.player.x; prevPY = game.player.y; last = performance.now(); started = true;
  requestAnimationFrame(frame);
  if (BENCH) startBench();
})();
async function startBench() {
  document.title = tr('ЗАВОД-7 — замер производительности');
  const cap = settings.fpsCap; settings.fpsCap = 0; settings.autosaveMin = 0; // только в этой вкладке, в настройки не пишется
  benchState.running = true; ui.toggle('perf');
  let lastR = 0;
  try {
    benchState.file = await runBench({
      loadRef: async () => {
        if (!REF_BASE) throw new Error('эталонная база не встроена в сборку');
        if (BENCH_MEGA) { // v1.9: мегабаза строится в Worker: эталонная база + ячейки с лентами (src/sim/megabase.ts)
          if (!sim) throw new Error('мегабаза — только с симуляцией в Worker');
          await sim.mega(REF_BASE, 165); const t0 = performance.now(); while (game.ents.size < 15000 && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
        } else await ui.h.loadSaveString(REF_BASE);
        ui.open = null; ui.toggle('perf');
      },
      setZoom: z => { view.zoom = z; }, frameCost: () => ({ n: frameN, ms: Array.from(frameCost) }), ups: () => sim ? sim.ups : 60, ents: () => game.ents.size,
      renderer: () => R.mode, rendererNote: () => R.modeNote, preset: () => settings.gfx, settings: () => ({ ...settings, fpsCap: cap, tex: texQuality() }),
      progress: (t, f) => { benchState.text = tr(t); benchState.frac = f; const now = performance.now(); if (now - lastR > 500 && ui.open === 'perf') { lastR = now; ui.render(true); } },
    }, { ...(/[?&]benchfast=1/.test(location.search) ? { warm: 2, sec: 3 } : {}), mega: BENCH_MEGA });
    beta.log('info', `bench: ${JSON.stringify(benchState.file.result)} gpu ${benchState.file.system.gpu}`);
  } catch (e) { benchState.text = tr('Замер не удался') + ': ' + (e as Error).message; beta.log('error', 'bench: ' + (e as Error).message); }
  benchState.running = false; settings.fpsCap = cap; if (ui.open !== 'perf') ui.toggle('perf'); else ui.render(true);
}
// PWA: только по http(s) — с file:// service worker и манифест недоступны
if (location.protocol.startsWith('http')) {
  const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker:', e));
}
(window as any).__zavod = { R, beta, bench: benchState, frameCost: () => ({ n: frameN, ms: Array.from(frameCost.subarray(0, Math.min(256, frameN))) }), get game() { return game; }, sim, workerEval: (code: string) => sim ? sim.eval(code) : Promise.resolve(new Function('g', code)(game)), view, ui, takeBp, setTool, recipes: RECIPES, audio, voice, settings, store, saveTo, loadFrom, mp, mpui, mods, applyModSet };
void RECIPES; void (null as unknown as Entity);
