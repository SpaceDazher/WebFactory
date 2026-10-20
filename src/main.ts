// Точка входа: игровой цикл, ввод, сохранения.
import { heatTemp } from './sim/heat';
import type { GenSet } from './sim/world';
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
import { CHUNK, Dir, TICKS } from './core/types';
import { generateTextures, texQuality, setTexQuality } from './render/textures';
import { detectPreset, presetSettings, matchPreset, FpsWatch, PRESETS, PRESET_NAMES, Preset } from './client/gfx';
import { wheelZoom, IS_MAC, uiScaleStyle, installGestures } from './client/input';
import type { EnemyMode } from './sim/enemies';
import { creepAt } from './sim/enemies';
import { bioCorpseSampleItem, bioLivingTicksLeft, bioSampleProduct, bioTicksLeft, nearbyBioCorpses, type BioSampleMode } from './sim/bio';
import { packStr as pack, unpackStr as unpack } from './core/pack';
import { Blueprint, makeBlueprint, rotateBp, flipBp } from './sim/blueprint';
import { copyChestSettings, type ChestSettings } from './sim/chest-settings';
import { wallGridPositions } from './sim/wall-grid';
import { nextPole, inspectPole, poleNode, poleOwner, type PoleRef } from './sim/polechain';
import { GameAudio } from './client/audio';
import * as store from './client/store';
import { loadSettings, saveSettings, Settings, keyName, ACTIONS, loadLayout } from './client/settings';
import { evCode, comboOf, actionOf, baseCode, MOD_CODES, KeyEv } from './client/keys';
import { WorkerSim } from './client/mirror';
import { tr, setLang, LANG } from './core/i18n';
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
import { NativeClient } from './client/native';
import { NativeUI } from './ui/nativeui';
import { planParallelRails, railEnds, railAt, carNear, trainMs, PlanPiece, graph as railGraph, nk, SIG_OX, SIG_OY } from './sim/trains';
import { shapeOf, pointOn, isRailProto } from './sim/railgeo';
import { adjustRailSpacing, railCellFree, railPieceKnown, railPreviewTarget } from './client/railui';
import { T_SHALLOW } from './sim/world';
import { ModStore, modDiff, ModDiff } from './client/modstore';
import { applyMods, activeMods, lastApply, spriteFiles, ApplyReport } from './mods/registry';
import { errText } from './mods/mod';
import { ModsUI } from './ui/modsui';
import { ScnUI } from './ui/scnui';
import { xQuery } from './sim/mgmt';
import { XUi } from './ui/xui';
import { MapEditor } from './ui/editor';
import * as scnstore from './client/scnstore';
import type { Scenario } from './sim/scenario';
import { ModRuntime } from './ui/modrt';
import { ScriptHost, browserSpawn, scriptMods } from './mods/script';
import { setModArt, modSpriteCount } from './render/art';
declare const __FEEDBACK__: string;
/** v1.1: вкладка замера производительности (?bench=1) — эталонная база, без сохранений и автосохранений */
const BENCH = /[?&]bench=(1|mega|L[1-5])/.test(location.search), BENCH_MEGA = /[?&]bench=mega/.test(location.search);
/** v1.11: уровень замера 1–5 (?bench=L3); ?bench=1 — уровень 2 (эталонная база), ?bench=mega — как раньше */
const BENCH_LEVEL = +(/[?&]bench=L([1-5])/.exec(location.search)?.[1] || 0);
const benchState = { running: false, text: '', frac: 0, file: null as BenchFile | null, info: null as any, level: 0 };

beta.installHooks();

const settings: Settings = loadSettings();
setLang(settings.lang); setColorblind(settings.colorblind);
const audio = new GameAudio(); audio.vol = { master: settings.master, sfx: settings.sfx, music: settings.music, ambient: settings.ambient };
let speakerWorldRef: unknown = null, speakerCursor = 0;
const speakerLoopIds = new Set<string>();
let speakerOneShotChannels = new Set<string>();
const speakerOneShotMeta = new Map<string, { channelKey: string; sound: string; audible: number; entityId: number; preview: boolean; baseVolume: number; dx: number; dy: number; radius: number; global: boolean }>();
let speakerPreviewSeq = 0;
function previewSpeaker(entityId: number) {
  const cfg = game.v117.speakers.configs[String(entityId)] || { sound: 'attack-siren', volume: 60 };
  const audioKey = `speaker-preview:${entityId}:${game.tick}:${++speakerPreviewSeq}`, volume = cfg.volume * settings.speakerVolume;
  audio.ensure(); audio.playSpeaker(cfg.sound, 0, 0, 64, volume, true, audioKey);
  if (audio.speakerOneShotActive(audioKey)) speakerOneShotMeta.set(audioKey, { channelKey: `preview:${audioKey}`, sound: cfg.sound, audible: volume, entityId, preview: true, baseVolume: cfg.volume, dx: 0, dy: 0, radius: 64, global: true });
}
function syncSpeakerAudio() {
  const speakers = game.v117.speakers, worldRef = game.world;
  if (worldRef !== speakerWorldRef) {
    audio.stopAllSpeakerLoops(); audio.stopAllSpeakerOneShots(); speakerLoopIds.clear(); speakerOneShotChannels.clear(); speakerOneShotMeta.clear(); speakerWorldRef = worldRef;
    speakerCursor = Math.max(0, ...speakers.events.map(e => e.id));
  }
  const events = speakers.events.filter(e => e.id > speakerCursor).sort((a, b) => a.id - b.id);
  if (events.length) speakerCursor = Math.max(speakerCursor, ...events.map(e => e.id));
  // Local previews keep their original settings but follow the listener's current category volume,
  // including while world time is paused. They never change shared speaker state.
  for (const [audioKey, meta] of speakerOneShotMeta) {
    if (!audio.speakerOneShotActive(audioKey)) { speakerOneShotMeta.delete(audioKey); continue; }
    if (!meta.preview) continue;
    const volume = meta.baseVolume * settings.speakerVolume;
    meta.audible = volume * (meta.global ? 1 : Math.max(0, 1 - Math.hypot(meta.dx, meta.dy) / Math.max(1, meta.radius)));
    if (meta.audible <= 0) { audio.stopSpeakerOneShot(audioKey); speakerOneShotMeta.delete(audioKey); }
    else audio.updateSpeakerOneShot(audioKey, meta.dx, meta.dy, meta.radius, volume, meta.global);
  }
  if (paused || !!mp?.session?.paused || !!game.mpv?.mp?.paused) {
    audio.stopAllSpeakerLoops(); audio.stopAllSpeakerOneShots(false); speakerLoopIds.clear(); speakerOneShotChannels.clear();
    for (const [audioKey, meta] of speakerOneShotMeta) if (!meta.preview) speakerOneShotMeta.delete(audioKey);
    return;
  }
  const listener = game.v117.playerIds[game.pl] || 'player-1';
  const channel = (c: { group: string; sound: string; range: string; playback: string; entityId: number }) => `${c.group || `speaker-${c.entityId}`}|${c.sound}|${c.range}|${c.playback}`;
  const current = Object.values(speakers.configs).filter(c => c.active && game.ents.get(c.entityId)?.proto === 'programmable-speaker').map(c => {
    const e = game.ents.get(c.entityId)!; const x = e.x + e.w / 2, y = e.y + e.h / 2, dx = x - game.player.x, dy = y - game.player.y;
    return { c, x, y, dx, dy, audible: c.volume * settings.speakerVolume * (c.range === 'global' ? 1 : Math.max(0, 1 - Math.hypot(dx, dy) / c.radius)), key: channel(c) };
  }).filter(x => x.audible > 0);
  const activeOneShots = new Set(current.filter(x => x.c.playback !== 'continuous').map(x => x.key));
  for (const key of speakerOneShotChannels) if (!activeOneShots.has(key)) { const audioKey = `speaker:${key}`; audio.stopSpeakerOneShot(audioKey); speakerOneShotMeta.delete(audioKey); }
  speakerOneShotChannels = activeOneShots;
  const priority = (sound: string) => sound === 'attack-siren' ? 0 : 1;
  const better = (a: any, b: any) => priority(a.sound) - priority(b.sound) || b.audible - a.audible || a.entityId - b.entityId;
  const loopOptions = new Map<string, any>(), shotSources = new Map<string, any>();
  for (const x of current) {
    const candidate = { kind: 'loop', key: x.key, sound: x.c.sound, audible: x.audible, entityId: x.c.entityId, x: x.x, y: x.y, dx: x.dx, dy: x.dy, radius: x.c.radius, baseVolume: x.c.volume, volume: x.c.volume * settings.speakerVolume, global: x.c.range === 'global' };
    const options = x.c.playback === 'continuous' ? loopOptions : shotSources;
    const old = options.get(x.key); if (!old || better(candidate, old) < 0) options.set(x.key, candidate);
  }
  // Keep the same clip and phase when the loudest live member changes within a group.
  for (const [audioKey, meta] of speakerOneShotMeta) if (!meta.preview) {
    const source = shotSources.get(meta.channelKey);
    if (!source) { audio.stopSpeakerOneShot(audioKey); speakerOneShotMeta.delete(audioKey); continue; }
    meta.audible = source.audible; meta.entityId = source.entityId; meta.baseVolume = source.baseVolume;
    meta.dx = source.dx; meta.dy = source.dy; meta.radius = source.radius; meta.global = source.global;
  }
  const eventOptions = new Map<string, any>();
  for (const e of events) {
    if (e.listener && e.listener !== listener || e.loop || e.playback === 'continuous') continue;
    const preview = !!e.listener, groupKey = channel({ group: e.group, sound: e.sound, range: e.range, playback: e.playback, entityId: e.emitter });
    const key = preview ? `preview:${e.id}` : groupKey, dx = e.x - game.player.x, dy = e.y - game.player.y;
    const source = !preview ? shotSources.get(groupKey) : null;
    const audible = source?.audible ?? e.volume * settings.speakerVolume * (e.range === 'global' ? 1 : Math.max(0, 1 - Math.hypot(dx, dy) / e.radius)); if (audible <= 0) continue;
    const audioKey = preview ? `speaker-preview:${e.id}` : `speaker:${groupKey}`;
    const candidate = { kind: 'event', key, sound: e.sound, audible, entityId: e.emitter, dx, dy, radius: e.radius, baseVolume: e.volume, volume: e.volume * settings.speakerVolume, global: e.range === 'global', ...(source ? { audible: source.audible, entityId: source.entityId, dx: source.dx, dy: source.dy, radius: source.radius, baseVolume: source.baseVolume, volume: source.volume, global: source.global } : {}), audioKey, preview };
    const old = eventOptions.get(key); if (!old || better(candidate, old) < 0) eventOptions.set(key, candidate);
  }
  const choices = new Map<string, any>();
  for (const x of loopOptions.values()) choices.set(x.key, x);
  for (const [audioKey, meta] of speakerOneShotMeta) if (audio.speakerOneShotActive(audioKey)) choices.set(meta.channelKey, { kind: 'shot', key: meta.channelKey, sound: meta.sound, audible: meta.audible, entityId: meta.entityId, audioKey, preview: meta.preview });
  for (const x of eventOptions.values()) if (!choices.has(x.key)) choices.set(x.key, x);
  const selected = [...choices.values()].sort(better).slice(0, 4);
  const nextLoops = new Set<string>();
  for (const x of selected) if (x.kind === 'loop') { nextLoops.add(x.key); audio.startSpeakerLoop(x.key, x.sound, x.dx, x.dy, x.radius, x.volume, x.global); }
  for (const key of speakerLoopIds) if (!nextLoops.has(key)) audio.stopSpeakerLoop(key);
  speakerLoopIds.clear(); for (const key of nextLoops) speakerLoopIds.add(key);
  const selectedAudioKeys = new Set<string>();
  for (const x of selected) {
    if (x.kind === 'shot') { const meta = speakerOneShotMeta.get(x.audioKey)!; audio.updateSpeakerOneShot(x.audioKey, meta.dx, meta.dy, meta.radius, meta.baseVolume * settings.speakerVolume, meta.global); selectedAudioKeys.add(x.audioKey); continue; }
    if (x.kind !== 'event') continue;
    audio.playSpeaker(x.sound, x.dx, x.dy, x.radius, x.volume, x.global, x.audioKey);
    if (audio.speakerOneShotActive(x.audioKey)) {
      selectedAudioKeys.add(x.audioKey); speakerOneShotMeta.set(x.audioKey, { channelKey: x.key, sound: x.sound, audible: x.audible, entityId: x.entityId, preview: x.preview, baseVolume: x.baseVolume, dx: x.dx, dy: x.dy, radius: x.radius, global: x.global });
    }
  }
  for (const [audioKey] of speakerOneShotMeta) if (!selectedAudioKeys.has(audioKey)) { audio.stopSpeakerOneShot(audioKey); speakerOneShotMeta.delete(audioKey); }
}
// озвучка ОСКАРа и интерфейса: включается первым жестом игрока (браузеры не дают говорить раньше)
const voice = new Voice(audio, () => settings);
for (const evn of ['pointerdown', 'keydown']) window.addEventListener(evn, () => { audio.ensure(); voice.unlock(); }, { capture: true });
/** v1.11: состояние интерфейса в сохранении — 4 ряда быстрого доступа, закрепления, снятые вручную предметы */
const uiSave = () => ({ hotbar: ui.hotbar, hotPin: ui.hotPin, hotBan: ui.hotBan, zoom: view.zoom });
function uiLoad(u: any) {
  const hb: (string | null)[] = Array.isArray(u.hotbar) ? u.hotbar.slice(0, 40) : []; while (hb.length < 40) hb.push(null);
  ui.hotbar = hb.map(x => x && ITEMS[x] ? x : null); ui.hotPin = Array.from({ length: 40 }, (_, i) => !!(u.hotPin?.[i]) && !!ui.hotbar[i]); ui.hotBan = Array.isArray(u.hotBan) ? u.hotBan.filter((x: string) => ITEMS[x]) : [];
}
const K = (a: string) => baseCode(settings.keys[a]);
/** v1.11: зажата ли клавиша действия (любое из двух назначений, без учёта модификаторов) */
const held = (a: string) => { const k1 = baseCode(settings.keys[a]), k2 = baseCode(settings.keys2[a] || ''); return (!!k1 && keys.has(k1)) || (!!k2 && keys.has(k2)); };
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
let native: NativeClient | null = null;
if (sim) sim.onReset = () => { game = sim!.g; };
let lastNucSave = 0;
if (sim) sim.onNuc = k => { if (k === 'overheat' && Date.now() - lastNucSave > 120000) { lastNucSave = Date.now(); saveTo('auto-reactor'); beta.log('warn', 'reactor overheat: emergency autosave'); } };
let profDetail = false; // v1.9: подробный профайлер (Shift+F3)
const view: View = { zoom: 1, ranges: 1, cursor: null, rot: 0, stationLeft: false, alt: false, mouseX: 0, mouseY: 0, mouseIn: false, hoverEnt: null, hoverDroneId: null, selectedDroneId: null, ghostOk: null, ghostPos: null, debug: false, brush: 1 };
const keys = new Set<string>();
let lmb = false, rmb = false, paused = false, speed = 1;
let menuPauseActive = false, menuWasPaused = false, menuWasMpPaused = false;
let selectedDroneActionSerial = 0;
let drag: { x: number; y: number; dir: number; placed: boolean } | null = null;
let copiedRecipe: string | null = null;
/** v1.6: скопированные настройки схемотехники (Shift+ПКМ по комбинатору) — вставляются в постройку того же типа (Shift+ЛКМ) */
let copiedCC: { t: string; cc: any } | null = null;
let copiedChest: ChestSettings | null = null;
let prevPX = 0, prevPY = 0;
let lastBp: Blueprint | null = null, lastPaste: [number, number] | null = null, seenRockets = 0;
let altHeld = false, altCombo = false;
type Tool = 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel' | 'group';
const TOOL_NAMES: Record<Tool, string> = { group: 'Группа: протяните рамку ЛКМ по постройкам, откроется окно «Завод»', copy: 'Копирование: протяните рамку ЛКМ', cut: 'Вырезание: протяните рамку ЛКМ', decon: 'Снос: рамка ЛКМ — пометить, ПКМ — снять', upgrade: 'Улучшение: рамка ЛКМ — пометить, ПКМ — снять', cancel: 'Отмена стройки: рамка ЛКМ — убрать призраки' };
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
  const uiState = uiSave();
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
let worldChoice = 0;
const chooseWorld = () => { if (native?.unresolvedHandoff) throw new Error(tr('Сначала проверьте передачу текущего мира серверу')); return ++worldChoice; };
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
function applyLoaded(data: any, opt: { force?: boolean; label?: string; choice?: number } = {}) {
  const choice = opt.choice ?? chooseWorld();
  if (choice !== worldChoice) return false;
  beta.log('info', `load: seed ${data.seed}, tick ${data.tick}, save v${data.v}`);
  validateSave(data, SAVE_VERSION); // битый файл или сохранение из новой версии — ошибка сразу, текущая партия не трогается
  // v1.10: другой набор модов — спросить (включить нужные / загрузить без них / отмена)
  if (!opt.force && !BENCH) { const d = modDiff(Array.isArray(data.mods) ? data.mods : [], activeMods(), mods); if (!d.ok) { pendingLoad = { data, label: opt.label || tr('из файла'), diff: d, choice }; beta.log('info', `load: mods differ (need ${d.need.map(n => n.ref.name).join(', ')}; extra ${d.extra.map(x => x.name).join(', ')})`); if (ui.open !== 'modcheck') ui.toggle('modcheck'); else ui.render(true); return false; } }
  native?.leaveForLocalWorld();
  if (mp?.active) { mp.close(); game.msg('Вы вышли из совместной игры: загружено сохранение'); } // v1.14.1: загрузка посреди сеанса не должна оставлять его висеть
  if (sim) { sim.load(data); game = sim.g; } else { game = deserialize(data); const rt = reportText(game.loadReport, SAVE_VERSION); if (rt) game.msg(rt); }
  view.cursor = null;
  if (data.ui) { uiLoad(data.ui); view.zoom = data.ui.zoom || 1; }
  prevPX = game.player.x; prevPY = game.player.y; seenRockets = data.rockets || 0; takeBp(null); setTool(null); ui.menuReturnTo = null; ui.close(); /* v1.16: новая или загруженная партия из окна внутри меню закрывает меню и снимает паузу */ voice.reset(); game.msg('Игра загружена');
  return true;
}
async function loadFrom(slot: string, choice = chooseWorld()) {
  const s = await store.get(slot); if (choice !== worldChoice) return false; if (!s) { game.msg('Слот пуст'); return; }
  try { const data = await unpack(s); if (choice !== worldChoice) return false; return applyLoaded(data, { label: slot.startsWith('auto') ? tr('Автосохранение') : tr('Слот') + ' ' + slot, choice }); } catch (e) { alert(tr('Не удалось загрузить') + ': ' + (e as Error).message); return false; }
}
function listSaves(): SaveMeta[] { const meta = getMeta(); return Object.keys(meta).map(k => ({ slot: k, ...meta[k] })); }
let autoIdx = 0, lastAuto = performance.now();
function autosaveCheck(now: number) {
  if (native?.engaged || native?.unresolvedHandoff) return; // The headless authority owns its autosave rotation.
  if (paused || settings.autosaveMin <= 0 || now - lastAuto < settings.autosaveMin * 60000) return;
  lastAuto = now; saveTo('auto' + (autoIdx % 3 + 1)); autoIdx++;
}
function newGame(seed: number, mode: EnemyMode = 'normal', scn?: Scenario, gen?: GenSet | null) {
  chooseWorld();
  native?.leaveForLocalWorld();
  if (mp?.active) mp.close(); // v1.14.1
  beta.log('info', `new game: seed ${seed}, mode ${mode}${scn ? ', scenario ' + scn.id : ''}`);
  if (sim) { sim.newGame(seed, mode, scn, gen); game = sim.g; } else game = new Game(seed, true, gen ? { enemies: mode, gen } : { enemies: mode }, scn); uiLoad({}); view.cursor = null; prevPX = game.player.x; prevPY = game.player.y; seenRockets = 0; takeBp(null); setTool(null); ui.menuReturnTo = null; ui.close(); /* v1.16: новая или загруженная партия из окна внутри меню закрывает меню и снимает паузу */ voice.reset();
  if (scn) { game.msg('ОСКАР: ' + scn.name + ' — цели слева вверху. Меню (Esc) → «Испытания» — другие карты.'); } else intro();
}
function intro() {
  game.msg('ОСКАР: Крушение на Кеплер-7b. Корпус разрушен, связи нет.');
  game.msg('ОСКАР: Построй завод и запусти маяк. Начни с добычи руды (ПКМ).');
}

// ---------- v1.10: моды ----------
/** v1.15: скрипты модов (без сценария) и скрипт сценария партии — в режиме без Worker */
let mainBase: import('./mods/script').ScriptMod[] = [];
const scnScript = (x: Game): import('./mods/script').ScriptMod[] => x.scn?.script ? [{ name: 'scn-' + x.scn.id, title: x.scn.name, code: x.scn.script }] : [];
const mods = new ModStore(); let modBusy = false; /** данные игры уже сменились, а партия ещё старая — кадр не рисуется */ let modSwap = false; let pendingLoad: { data: any; label: string; diff: ModDiff; choice: number } | null = null;
/** применить включённые моды (главный поток и Worker); restart — партия сохраняется до смены данных и открывается после */
async function applyModSet(restart: boolean): Promise<ApplyReport> {
  const choice = worldChoice;
  modBusy = true; if (ui.open === 'mods') ui.render(true);
  try {
    let snap: any = null;
    if (restart) { const u = uiSave(); if (sim) snap = await unpack((await sim.save(u)).str); else { snap = JSON.parse(JSON.stringify(serialize(game))); snap.ui = u; } }
    const pk = mods.enabled(), prio = mods.order();
    modSwap = true;
    const rep = applyMods(pk, prio, beta.VERSION); modrt.reset();
    if (mainHost) { mainBase = scriptMods(rep.loaded.map(l => pk.find(p => p.info.name === l.name)!).filter(Boolean)); mainHost.mods = [...mainBase, ...scnScript(game)]; mainHost.attach(game); }
    if (sim) await sim.mods(pk.map(p => p.files), prio, beta.VERSION);
    const spr: Record<string, any> = {};
    for (const [k, b] of Object.entries(spriteFiles(pk, rep))) { try { spr[k] = await createImageBitmap(new Blob([b as BlobPart], { type: 'image/png' })); } catch (e) { rep.warnings.push({ mod: rep.sprites[k].mod, file: rep.sprites[k].path, msg: 'PNG не читается: ' + (e as Error).message, warn: true }); } }
    setModArt(spr); R.resetArt(); mods.dirty = false; ui.modCount = rep.loaded.length;
    beta.log('info', `mods: ${rep.loaded.map(m => m.name + '@' + m.version).join(', ') || 'none'}; failed ${rep.failed.length}; warnings ${rep.warnings.length}; ${rep.ms.toFixed(1)} ms`);
    for (const f of rep.failed) for (const e of f.errors.slice(0, 5)) beta.log('warn', 'mod error: ' + errText(e));
    if (snap && choice === worldChoice) { applyLoaded(snap, { force: true, choice }); game.msg(rep.loaded.length ? `Симуляция перезапущена: модов ${rep.loaded.length}` : 'Симуляция перезапущена без модов'); }
    game.enqueue({ t: 'teleMods', ev: `apply ${rep.loaded.map(m => m.name + '@' + m.version).join(',') || '-'}${rep.failed.length ? ' failed ' + rep.failed.map(f => f.name).join(',') : ''}` });
    if (rep.failed.length) game.msg(`Моды с ошибками не загружены: ${rep.failed.map(f => f.title).join(', ')} — подробности: Esc → «Моды»`);
    return rep;
  } finally { modBusy = false; modSwap = false; }
}
const modsLine = () => { const r = lastApply(); return r && (r.loaded.length || r.failed.length) ? `\nмоды: ${r.loaded.map(m => m.name + ' ' + m.version).join(', ') || 'нет'}${r.failed.length ? ` · с ошибками ${r.failed.length}` : ''} · применены за ${r.ms.toFixed(1)} мс · спрайтов ${modSpriteCount()}` : ''; };

const saveString = async () => sim ? (await sim.save(uiSave())).str : await pack(serialize(game));
const simTele = (): Promise<any> => sim ? sim.teleReport() : Promise.resolve(teleReport(game));
const clientInfo = () => beta.clientPart({ renderer: R.mode, rendererNote: R.modeNote, worker: !!sim, settings, gpu: gpuName(R.gameGL(), R.mode) });
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
  loadSaveString: async str => { const choice = chooseWorld(); const data = await unpack(beta.extractSave(str)); if (choice === worldChoice) applyLoaded(data, { choice }); },
  errors: () => beta.errorCount,
  openBench: (lv?: number) => { const u = location.href.replace(/[?#].*$/, '') + (lv ? '?bench=L' + lv : '?bench=1') + (/[?&]render=\w+/.exec(location.search)?.[0].replace('?', '&') || ''); if (!window.open(u, '_blank')) location.href = u; },
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
  voiceInfo: () => voice.engineName(), voiceList: () => voice.voices().map(v => v.name), voiceTest: () => { audio.ensure(); voice.unlock(); voice.say(tr('ОСКАР: Связь установлена. Голос работает, инженер.'), 'oscar', true); }, speakerListen: previewSpeaker,
  exportSave: async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([sim ? (await sim.save(uiSave())).str : await pack(serialize(game))])); a.download = `zavod7-${game.seed}-${game.tick}.z7save`; a.click(); },
  getSettings: () => settings, setSettings: (p: Partial<Settings>) => { Object.assign(settings, p); if (['resScale', 'dprMax', 'fpsCap', 'detail', 'smoke', 'dayNight'].some(k => k in p)) settings.gfxAuto = false; applySettings(); saveSettings(settings); }, storageInfo: () => storageInfo, workerActive: () => !!sim, rendererMode: () => R.mode, rendererNote: () => R.modeNote, setRenderer: (m: 'auto' | 'webgl' | 'canvas') => { settings.renderer = m; saveSettings(settings); return R.setMode(m); },
  importSave: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.z7save,.txt'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; const choice = chooseWorld(); try { const data = await unpack(beta.extractSave(await f.text())); if (choice === worldChoice) applyLoaded(data, { choice }); } catch (e) { alert(tr('Файл повреждён') + ': ' + (e as Error).message); } }; i.click(); },
});
loadLayout(() => { if (ui.open === 'settings' || ui.open === 'help') ui.render(true); });

// ---------- v1.12: совместная игра (только в режиме Worker) ----------
const mp = sim ? new MpClient(sim, () => ({ name: settings.mpName || tr('Инженер'), color: settings.mpColor, server: settings.mpServer, ice: settings.mpIce, relay: /[?&]relay=1/.test(location.search), pass: mpui?.pass || '' })) : null;
// v1.15: испытания, достижения, редактор карт
const pickText = (accept: string) => new Promise<string | null>(res => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { const f = i.files?.[0]; res(f && f.size < 5 * 1048576 ? await f.text() : null); }; i.oncancel = () => res(null); i.click();
});
let edPaused = false;
const editor = new MapEditor({
  play: s => newGame(s.seed || 1, s.rules.enemies, s), closed: () => { void scnui.refresh(); },
  download: (n, t) => beta.download(n, t), pickFile: pickText, msg: t => game.msg(t), saveStore: s => scnstore.saveScenario(s),
  setPaused: p => { if (p) { edPaused = paused; paused = true; } else paused = edPaused; sim?.post({ t: 'pause', paused }); },
});
const openEditor = (s?: Scenario) => { if (mp?.inGame) { game.msg('В совместной игре редактор карт недоступен — сначала выйдите (Tab → «Выйти»)'); return; } if (ui.open !== 'menu') ui.close(); editor.open(s); };
const scnui = new ScnUI({ game: () => game, play: s => newGame(s.seed || 1, s.rules.enemies, s), render: () => ui.render(true), toggle: w => ui.toggle(w as any), close: () => ui.close(), open: () => ui.open,
  download: (n, t) => beta.download(n, t), pickFile: pickText, inMp: () => !!mp?.inGame, openEditor, msg: t => game.msg(t), sound: k => audio.play(k) });
ui.scn = scnui;
ui.x = new XUi({ game: () => game, render: () => ui.render(true), close: () => ui.close(), toggle: w => ui.toggle(w as any), open: () => ui.open,
  tool: t => setTool(t), openEnt: id => ui.toggle('ent', id), query: (q, a) => sim ? sim.xq(q, a) : Promise.resolve(xQuery(game, q, a)),
  hl: r => { view.hl = r.slice(0, 400).map(q => ({ ...q, until: performance.now() + 4000 })); },
  mapArea: r => { if (ui.open !== 'map') ui.toggle('map'); Object.assign(ui.mapv, { cx: r.x + r.w / 2, cy: r.y + r.h / 2, tpp: .25, follow: false }); setTimeout(drawBigMap, 0); } });
native = sim ? new NativeClient(sim, () => ({ name: settings.mpName || tr('Инженер'), color: settings.mpColor })) : null;
const nativeui = native ? new NativeUI(native, () => game, () => { if (ui.open === 'mp' || ui.open === 'players') ui.render(true); }, () => !mp?.active || mp.isHost) : null;
if (native) { native.onBeforeAttach = () => { if (mp?.active) mp.close(true); ++worldChoice; keys.clear(); lmb = rmb = false; }; native.onHandoff = async result => { await mp?.nativeMigrate(result.peerMigrations || []); }; native.onChange = () => { if (native?.connecting && !started && ui.open !== 'mp') ui.toggle('mp'); if (native?.connected) { paused = false; lastInput = ''; } if (ui.open === 'mp' || ui.open === 'players') ui.render(true); }; }
const mpui = mp ? new MpUI({ mp, game: () => game, settings: () => settings, setSettings: p => { Object.assign(settings, p); saveSettings(settings); }, render: () => ui.render(true), close: () => ui.close(), toggle: w => ui.toggle(w as any), open: () => ui.open, msg: t => game.msg(t), download: (n, t) => beta.download(n, t), sound: k => audio.play(k), chooseSession: chooseWorld, nativeHtml: () => nativeui?.html() || '', nativeActive: () => !!native?.engaged, nativePlayers: () => nativeui?.players() || '' }) : null;
ui.ext = { html: w => mpui ? mpui.html(w) : `<div class="panel"><div class="title">Совместная игра <span class="x" data-act="close">✕</span></div><div>Совместная игра работает только с симуляцией в отдельном потоке: Esc → Настройки → «Симуляция в Worker».</div></div>`,
  act: (a, el) => { if (nativeui?.act(a)) return true; if (!mpui) { if (a === 'mpopen') { ui.toggle('mp'); return true; } return false; } return mpui.act(a, el); }, inGame: () => !!mp?.inGame || !!native?.engaged };
ui.mods = new ModsUI({
  store: mods, report: () => lastApply(), busy: () => modBusy, game: beta.VERSION,
  apply: async () => { if (mp?.inGame || native?.engaged || native?.unresolvedHandoff) { game.msg('В совместной игре моды не меняются — сначала выйдите'); return; } await applyModSet(true); if (ui.open !== 'mods') ui.toggle('mods'); else ui.render(true); },
  download: (n, b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/zip' })); a.download = n; a.click(); game.enqueue({ t: 'teleMods', ev: 'export ' + mods.enabled().length }); },
  msg: t => game.msg(t), render: () => ui.render(true), close: () => ui.close(),
  pending: () => pendingLoad, scriptStats: () => modrt.stats,
  resolve: how => {
    const p = pendingLoad; pendingLoad = null; if (!p || p.choice !== worldChoice) { ui.close(); return; }
    beta.log('info', 'load with other mods: ' + how);
    if (how === 'cancel') { ui.close(); return; }
    if (how === 'without') { try { applyLoaded(p.data, { force: true, choice: p.choice }); } catch (e) { alert(tr('Не удалось загрузить') + ': ' + (e as Error).message); } game.enqueue({ t: 'teleMods', ev: 'load-without ' + p.diff.need.map(n => n.ref.name).join(',') }); return; }
    mods.enableExactly(p.data.mods || []).then(async miss => { await applyModSet(false); applyLoaded(p.data, { force: true, choice: p.choice }); if (miss.length) game.msg(`Не установлены моды: ${miss.join(', ')} — их постройки убраны`); game.enqueue({ t: 'teleMods', ev: 'load-enable ' + p.diff.need.map(n => n.ref.name).join(',') }); });
  },
});
// v1.11: скрипты модов — консоль и окна; без Worker симуляции хост скриптов живёт в главном потоке
const modrt = new ModRuntime(c => game.enqueue(c), () => { if (ui.open === 'console' || ui.open === 'mods') ui.render(true); });
ui.modrt = modrt;
if (sim) { sim.onMod = m => modrt.onMsg(m, m.me || 0); const r0 = sim.onReset; sim.onReset = k => { r0?.(k); if (!k) modrt.reset(); }; }
const mainHost: ScriptHost | null = sim ? null : new ScriptHost(browserSpawn, { onConsole: l => modrt.onMsg({ t: 'modcon', l }), onGui: (mod, title, op) => modrt.onMsg({ t: 'modgui', mod, title, op }), command: c => game.enqueue(c) });
if (mainHost) setInterval(() => { if (mainHost.slots.length) modrt.onMsg({ t: 'modstat', s: mainHost.stats() }); }, 500);
let mpSig = '', mpWasGame = false;
if (mp) mp.onEvent = (e, d) => {
  const s = mp.session;
  const sig = `${s?.state}|${s?.isHost}|${mp.mode}|${mp.manual.map(m => m.phase + (m.code ? 'c' : '')).join()}|${mp.net.length}|${!!mp.err}|${s?.hostPl}|${!!mp.lastJoin}`; if (sig !== mpSig) { mpSig = sig; if (ui.open === 'mp') ui.render(true); }
  switch (e) {
    case 'native-migrate': {
      // Session has authenticated the sending host and ACKed receipt before this callback.
      try {
        const target = new URL(d.playOrigin);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.origin !== d.playOrigin || !/^[A-Za-z0-9_-]{32,128}$/.test(d.reconnectToken) || !Number.isFinite(d.expiresAt) || d.expiresAt <= Date.now()) throw new Error('Некорректное приглашение сервера');
        keys.clear(); lmb = rmb = false; leaving = true;
        target.hash = 'server-reconnect=' + encodeURIComponent(d.reconnectToken);
        location.replace(target.href);
      } catch { game.msg('Не удалось перейти на сервер — запросите новое приглашение у владельца'); }
      break;
    }
    case 'start': {
      mpWasGame = true;
      beta.log('info', `mp start: ${s?.players.length} players, me ${s?.me}`);
      ui.menuReturnTo = null;
      ui.close(); // v1.16: закрыть единое меню после старта совместной игры.
      view.cursor = null;
      takeBp(null);
      setTool(null);
      seenRockets = 1e9;
      setTimeout(() => {
        seenRockets = game.rockets;
        game.msg(`Совместная игра: игроков ${s?.players.length}. Чат — ${keyName(K('chat'))}, игроки — ${keyName(K('players'))}`);
      }, 500);
      break;
    }
    case 'closed': if (mpWasGame) { mpui!.lost(String(d || 'Связь с хостом потеряна')); game.msg(String(d || 'Совместная игра завершена')); } mpWasGame = false; beta.log('info', 'mp closed: ' + d); if (ui.open === 'players') ui.close(); break;
    case 'desync': beta.log('warn', `mp desync at tick ${d?.t}, player ${d?.i}`); if (s?.isHost) game.enqueue({ t: 'teleMp', ev: 'desync' }); break;
    case 'resync': game.msg('Состояние сверено с хостом'); break;
    case 'report': game.msg('Отчёт о рассинхроне готов: Tab → «Скачать отчёт»'); break;
    case 'drop': if (s) game.msg(`Игрок ${s.players[d]?.name || d}: нет связи — его персонаж ждёт 5 минут`); break;
    case 'host': if (s) { game.msg(d?.to === s.me ? 'Теперь вы — хост' : `Хост теперь — ${s.players[d?.to]?.name || d?.to}`); if (ui.open === 'players') ui.render(true); } break;
    case 'kicked': game.msg(String(d || 'Вас выгнали из игры')); break;
    case 'players': if (ui.open === 'players') ui.render(true); break;
    case 'pause': game.msg(d ? 'Хост поставил паузу' : 'Хост продолжил игру'); break;
  }
};
// v1.11: случайный Ctrl+W / Ctrl+R при игре — браузер спросит «Покинуть страницу?» (настройка «Спрашивать перед закрытием вкладки»)
window.addEventListener('beforeunload', ev => { if (started && !BENCH && settings.leaveGuard && !leaving && !navigator.webdriver) { ev.preventDefault(); (ev as any).returnValue = ''; return; } if (mp?.active) mp.close(true); });
window.addEventListener('pagehide', () => { if (mp?.active) mp.close(true); });
const markMod = (ev: MouseEvent) => { const k = K('mark'); return k === 'AltLeft' || k === 'AltRight' ? ev.altKey : keys.has(k); };

// ---------- ввод ----------
function mouseTile(): [number, number] { const dpr = R.pixelRatio(); const [wx, wy] = R.screenToWorld(view.mouseX * dpr, view.mouseY * dpr); return [wx, wy]; }
let bioSampleMode: BioSampleMode = 'sample';
function bioSampleAction() {
  if (game.player.bioSampling) { game.enqueue({ t: 'bioSample', target: null, cancel: true }); return; }
  let target: { id: number } | { x: number; y: number } | null = null;
  if (view.mouseIn) {
    const [wx, wy] = mouseTile(); const under = nearbyBioCorpses(game, wx, wy, 0.85)[0];
    if (under) target = { id: under.id };
    else { const x = Math.floor(wx), y = Math.floor(wy); if (creepAt(game, x, y) > 0) target = { x, y }; }
  }
  if (!target) { const nearest = nearbyBioCorpses(game, game.player.x, game.player.y, 2)[0]; if (nearest) target = { id: nearest.id }; }
  game.enqueue({ t: 'bioSample', target, mode: bioSampleMode });
}
let bioNotice = '', bioNoticeKey = '', bioNoticeAt = 0;
function updateBioHud(now: number) {
  const root = document.getElementById('biosample'), button = document.getElementById('biosample-btn') as HTMLButtonElement | null;
  const status = document.getElementById('bio-status'), bar = root?.querySelector<HTMLElement>('.bio-progress i');
  if (!root || !button || !status || !bar || R.frame % 6 !== 0) return;
  let select = document.getElementById('biosample-mode') as HTMLSelectElement | null;
  if (!select) {
    const label = document.createElement('label'); label.className = 'small';
    select = document.createElement('select'); select.id = 'biosample-mode';
    select.addEventListener('pointerdown', ev => ev.stopPropagation());
    select.addEventListener('change', () => { const mode = select!.value; if (mode === 'sample' || mode === 'genetic' || mode === 'cells') bioSampleMode = mode; });
    label.append(select); root.insertBefore(label, status);
  }
  const modes: [BioSampleMode, string, string][] = [['sample', 'Материал', 'bio-sampling'], ['genetic', 'Генетическая проба', 'swarm-genomics'], ['cells', 'Живые клетки', 'cellular-sampling']];
  if (!game.research.done.has(bioSampleMode === 'cells' ? 'cellular-sampling' : bioSampleMode === 'genetic' ? 'swarm-genomics' : 'bio-sampling')) bioSampleMode = 'sample';
  if (!select.options.length) for (const [mode] of modes) select.add(new Option('', mode));
  for (let i = 0; i < modes.length; i++) { select.options[i].text = tr(modes[i][1]); select.options[i].disabled = !game.research.done.has(modes[i][2]); }
  select.value = bioSampleMode; select.disabled = !!game.player.bioSampling; select.setAttribute('aria-label', tr('Тип пробы'));
  const task = game.player.bioSampling || null, keyLabel = keyName(settings.keys.bio || '');
  const bioHint = `${tr('Сначала наведите курсор на останки или слизь, затем нажмите')} ${keyLabel} ${tr('или кнопку')}`;
  button.textContent = task ? tr('Отменить забор') : `${tr('Биосбор')} · ${keyLabel}`;
  button.setAttribute('aria-label', button.textContent);
  button.title = task ? tr('Нажмите, чтобы отменить забор') : bioHint;
  let label = '', progress = 0;
  if (task) {
    const total = (task.target === 'corpse' ? 3 : 2) * TICKS;
    const remains = task.target === 'corpse' ? nearbyBioCorpses(game, game.player.x, game.player.y, 2).find(c => c.id === task.id) : undefined;
    label = task.target === 'corpse' ? (remains ? tr(ITEMS[bioSampleProduct(remains, task.mode)]?.name || 'Проба') : tr('Останки')) : `${tr('Слизь')} · ${task.x}, ${task.y}`;
    label += ` · ${(task.left / TICKS).toFixed(1)} ${tr('с')}`;
    if (remains) label += task.mode === 'cells' ? ` · ${tr('Жизнеспособность')}: ${Math.ceil(bioLivingTicksLeft(game, remains) / TICKS)} ${tr('с')}` : ` · ${tr('останки исчезнут через')} ${Math.ceil(bioTicksLeft(game, remains) / (60 * TICKS))} ${tr('мин')}`;
    progress = Math.max(0, Math.min(100, (1 - task.left / total) * 100));
  } else {
    const nearest = nearbyBioCorpses(game, game.player.x, game.player.y, 2)[0];
    if (nearest) label = `${tr('Ближайшие останки: ')}${tr(ITEMS[bioCorpseSampleItem(nearest)]?.name || 'Останки')} · ${tr('проб осталось: ')}${nearest.remainingSamples} · ${tr('истечёт через ')}${Math.ceil(bioTicksLeft(game, nearest) / (60 * TICKS))} ${tr('мин')}`;
    else if (view.mouseIn) { const [wx, wy] = mouseTile(), amount = creepAt(game, Math.floor(wx), Math.floor(wy)); if (amount > 0) label = `${tr('Слизь')} · ${amount}`; }
    if (!label) {
      for (let i = game.messages.length - 1; i >= 0; i--) {
        const m = game.messages[i], s = m.text;
        if (/биосбор|биоматериал|биосборник|биокапсул|останки|проба|слиз|Инвентарь полон/i.test(s)) {
          const mk = `${m.tick}|${s}`; if (mk !== bioNoticeKey) { bioNoticeKey = mk; bioNotice = s; bioNoticeAt = now; } break;
        }
      }
      label = bioNotice && now - bioNoticeAt < 6000 ? tr(bioNotice) : bioHint;
    }
  }
  status.textContent = label; bar.style.width = `${progress}%`;
  root.setAttribute('aria-label', `${tr('Биоматериалы')}: ${label}`);
}
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
const CAR_ITEMS: Record<string, boolean> = { locomotive: true, 'cargo-wagon': true, 'fluid-wagon': true, 'artillery-wagon': true };
type RailPreviewPiece = PlanPiece & { have?: boolean; valid?: boolean; ghost?: boolean; unknown?: boolean; reason?: string };
type RailPreview = { pieces: RailPreviewPiece[]; lanes: { sx: number; sy: number; ex: number; ey: number }[]; exact: boolean; ex: number; ey: number; tracks: number; spacing: number; actualSpacing: number; ghosts: number; unknown: number; blocked: number };
const ruCountForm = (count: number, one: string, few: string, many: string) => {
  const n = Math.abs(Math.trunc(count)), last = n % 10, lastTwo = n % 100;
  return last === 1 && lastTwo !== 11 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
};
let railDrag: { sx: number; sy: number; sh: number; moved: boolean; tx: number; ty: number; tracks: number; spacing: number; generation: number; forceGhost: boolean; plan: RailPreview | null } | null = null;
const railFree = (x: number, y: number) => railCellFree(game.world, x, y, T_SHALLOW);
const railHas = (p: PlanPiece) => { const s = shapeOf(p.proto, p.dir); const a = game.railCells.get(((p.x + s.ox + s.cells[0][0]) + 65536) * 131072 + (p.y + s.oy + s.cells[0][1] + 65536)); if (a) for (const id of a) { const e = game.ents.get(id); if (e && e.proto === p.proto && e.x === p.x && e.y === p.y && e.dir === p.dir) return true; } return false; };
/** начало пути: ближайший свободный конец рельса рядом с курсором (продолжение) или узел под курсором */
function railStart(wx: number, wy: number): [number, number, number] {
  let best: [number, number, number] | null = null, bd = 3;
  for (let y = Math.floor(wy) - 3; y <= Math.floor(wy) + 3; y++) for (let x = Math.floor(wx) - 3; x <= Math.floor(wx) + 3; x++) for (const id of game.railCells.get((x + 65536) * 131072 + (y + 65536)) || []) {
    const e = game.ents.get(id); if (!e) continue; for (const en of railEnds(e)) { const d = Math.hypot(en[0] - wx, en[1] - wy); if (d < bd) { bd = d; best = en; } } }
  return best || [Math.round(wx / 2) * 2, Math.round(wy / 2) * 2, -1];
}
function railPlanTo(wx: number, wy: number, shift = false) {
  const d = railDrag; if (!d) return;
  const [tx, ty] = railPreviewTarget(d.sx, d.sy, wx, wy);
  const ghostChanged = d.forceGhost !== shift; d.forceGhost = shift;
  if (tx === d.tx && ty === d.ty && d.plan && !ghostChanged) return;
  d.tx = tx; d.ty = ty; const generation = ++d.generation; d.plan = null;
  if (!d.moved && Math.hypot(tx - d.sx, ty - d.sy) < 4) return;
  d.moved = true;
  // Planning is pure and bounded; the simulation worker independently preflights every segment at commit time.
  const r = planParallelRails(d.sx, d.sy, d.sh, tx, ty, -1, railFree, railHas,
    { tracks: d.tracks, spacing: d.spacing, budget: 40000, maxPieces: 500, cancelled: () => generation !== d.generation || railDrag !== d });
  if (railDrag !== d || generation !== d.generation) return;
  const remaining: Record<string, number> = { 'straight-rail': game.inv.count('straight-rail'), 'curved-rail': game.inv.count('curved-rail') };
  const pieces: RailPreviewPiece[] = []; let ghosts = 0, unknown = 0, blocked = 0;
  for (const lane of r.lanes) for (const p of lane.pieces) {
    const have = railHas(p), known = have || railPieceKnown(game.world, p), c = have || !known ? { ok: true } : game.canPlace(p.proto, p.x, p.y, p.dir, false);
    const valid = c.ok || c.reason === 'Рельсы уже лежат';
    let ghost = false, reason = valid ? undefined : c.reason;
    if (valid && !have) {
      const range = known ? game.canPlace(p.proto, p.x, p.y, p.dir, true) : null;
      const inRange = !known ? false : range!.ok || range!.reason !== 'Слишком далеко';
      const hasStock = remaining[p.proto] > 0; if (hasStock) remaining[p.proto]--;
      ghost = d.forceGhost || !hasStock || !inRange;
      if (!known) unknown++;
      if (ghost) { ghosts++; reason = d.forceGhost ? 'Будет призраком' : !known ? 'Сектор ещё не открыт' : !hasStock ? 'Нет рельсов' : 'Слишком далеко'; }
    }
    if (!valid) blocked++;
    pieces.push({ ...p, have, valid, ghost, unknown: !known, reason });
  }
  const lanes = r.lanes.map(l => ({ sx: l.sx, sy: l.sy, ex: l.ex, ey: l.ey }));
  const end = lanes[lanes.length - 1];
  d.plan = { pieces, lanes, exact: r.exact && blocked === 0, ex: end?.ex ?? tx, ey: end?.ey ?? ty, tracks: r.tracks, spacing: r.spacing, actualSpacing: r.actualSpacing, ghosts, unknown, blocked };
}
function cancelRailDrag() { if (!railDrag) return; railDrag.generation++; railDrag = null; lmb = false; }
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
  } else if (t === 'group') {
    if (cancel) return; setTool(null); void ui.x!.pickRect(x0, y0, x1, y1);
  } else if (t === 'decon') game.enqueue({ t: 'decon', x0, y0, x1, y1, filter: ui.deconFilter, trees: ui.deconTrees, cancel });
  else if (t === 'cancel') { if (!cancel) game.enqueue({ t: 'cancelGhosts', x0, y0, x1, y1 }); }
  else game.enqueue({ t: 'upgrade', x0, y0, x1, y1, map: ui.upgradeMap(), cancel });
}
// v1.2: быстрая погрузка/разгрузка — Ctrl+ЛКМ / Ctrl+ПКМ (на macOS с «Ctrl+щелчок = ПКМ» — Cmd), протягиванием — по всем постройкам
const ctrlMod = (e: MouseEvent) => e.metaKey || (e.ctrlKey && !(IS_MAC && settings.ctrlClick));
/** v1.11: быстрая погрузка — Shift+ЛКМ / Shift+ПКМ (Ctrl+W при погрузке с ходьбой закрывал вкладку); копирование настроек — Ctrl.
 *  В настройках можно вернуть как было (погрузка — Ctrl, настройки — Shift). */
const quickMod = (e: MouseEvent) => settings.quickKey === 'ctrl' ? ctrlMod(e) : e.shiftKey && !e.ctrlKey && !e.metaKey && !(view.cursor && (FLOOR_BY_ITEM[view.cursor] || WIRE_OF[view.cursor] != null || isRailProto(ITEMS[view.cursor]?.place || '')));
const cfgMod = (e: MouseEvent) => settings.quickKey === 'ctrl' ? e.shiftKey : ctrlMod(e);
let quickDrag: { op: 'load' | 'unload'; seen: Set<number> } | null = null;
function quickAt(id: number, op: 'load' | 'unload', quiet: boolean) { game.enqueue({ t: 'quick', id, op, item: op === 'load' && view.cursor && !game.held ? view.cursor : undefined, quiet }); }
// стопка в руке: значок у курсора
const heldEl = document.createElement('div'); heldEl.id = 'held'; heldEl.style.cssText = 'position:fixed;pointer-events:none;z-index:50;display:none;width:36px;height:36px'; document.body.appendChild(heldEl);
type WallGridDrag = { proto: string; sx: number; sy: number; ex: number; ey: number; ghost: boolean };
let wallGridMode: 'line' | 'grid' = 'line', wallGridStep = 2, wallGridStagger = true;
let wallGridDrag: WallGridDrag | null = null;
const wallControls = document.createElement('div'); wallControls.id = 'wall-placement-controls';
wallControls.style.cssText = 'position:fixed;right:12px;bottom:112px;z-index:35;display:none;padding:8px 10px;border:1px solid #77858a;border-radius:7px;background:rgba(18,24,27,.94);color:#edf3ef;font:12px system-ui,sans-serif;box-shadow:0 3px 12px #0008;max-width:min(390px,calc(100vw - 24px))';
document.body.appendChild(wallControls);
function syncWallControls() {
  const proto = view.cursor ? ITEMS[view.cursor]?.place : null;
  const show = !ui.open && !!proto && PROTOS[proto]?.type === 'wall';
  wallControls.style.display = show ? 'block' : 'none';
  if (!show) { if (wallGridDrag) cancelWallGridDrag(); return; }
  const controlKey = `${proto}:${LANG}`;
  if (wallControls.dataset.proto === controlKey) return;
  wallControls.dataset.proto = controlKey;
  wallControls.innerHTML = `<div style="font-weight:700;margin-bottom:5px">${tr('Планировка стен')}</div><div style="display:flex;gap:4px;margin-bottom:5px"><button type="button" data-wall-mode="line">${tr('Линия')}</button><button type="button" data-wall-mode="grid">${tr('Сетка')}</button><label style="margin-left:auto;display:flex;align-items:center;gap:4px">${tr('Шаг сетки')} <input id="wall-placement-step" type="number" min="1" max="4" step="1" value="${wallGridStep}" style="width:42px"></label></div><label style="display:flex;align-items:center;gap:5px;margin-bottom:4px"><input id="wall-placement-stagger" type="checkbox" ${wallGridStagger ? 'checked' : ''}>${tr('Ряды вразбежку')}</label><div style="color:#c4ced0">${tr('Протяните рамку ЛКМ; Shift — призраки; Esc — отмена')}</div>`;
  wallControls.querySelectorAll<HTMLButtonElement>('[data-wall-mode]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.wallMode === wallGridMode));
    b.style.cssText = `padding:4px 8px;border:1px solid #718087;border-radius:4px;background:${b.dataset.wallMode === wallGridMode ? '#465f68' : '#293438'};color:#fff;cursor:pointer`;
    b.addEventListener('click', () => { cancelWallGridDrag(); wallGridMode = b.dataset.wallMode === 'grid' ? 'grid' : 'line'; wallControls.querySelectorAll<HTMLButtonElement>('[data-wall-mode]').forEach(q => { const active = q.dataset.wallMode === wallGridMode; q.setAttribute('aria-pressed', String(active)); q.style.background = active ? '#465f68' : '#293438'; }); });
  });
  const step = wallControls.querySelector<HTMLInputElement>('#wall-placement-step')!;
  step.addEventListener('change', () => { cancelWallGridDrag(); wallGridStep = Math.max(1, Math.min(4, Math.round(Number(step.value) || 1))); step.value = String(wallGridStep); wallControls.querySelector<HTMLInputElement>('#wall-placement-stagger')!.disabled = wallGridStep === 1; });
  const stagger = wallControls.querySelector<HTMLInputElement>('#wall-placement-stagger')!;
  stagger.disabled = wallGridStep === 1;
  stagger.addEventListener('change', () => { cancelWallGridDrag(); wallGridStagger = stagger.checked; });
}
function cancelWallGridDrag() { if (!wallGridDrag) return; wallGridDrag = null; lmb = false; view.wallPlan = null; }
let heldSig = ''
function drawHeld() {
  const h = game.held; const sig = h ? h.item + ':' + h.count : '';
  if (sig !== heldSig) { heldSig = sig; heldEl.innerHTML = h ? `<div class="slot" style="width:36px;height:36px;opacity:.92"><img src="${iconURL(h.item)}"><span class="cnt">${h.count}</span></div>` : ''; heldEl.style.display = h ? 'block' : 'none'; heldEl.dataset.item = h ? h.item : ''; heldEl.dataset.count = h ? String(h.count) : ''; }
  if (h) { heldEl.style.left = (view.mouseX + 10) + 'px'; heldEl.style.top = (view.mouseY + 10) + 'px'; }
}
function tryBuildAt(x: number, y: number, quiet: boolean) {
  const pid = ITEMS[view.cursor!]?.place; if (!pid) return;
  game.enqueue({ t: 'build', proto: pid, x, y, dir: view.rot as Dir, ...(pid === 'train-stop' ? { stopLeft: view.stationLeft === true } : {}), quiet });
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
type PoleDrag = { gesture: number; seq: number; owner: string; proto: string; dir: Dir; ghost: boolean; pending: boolean; anchor: PoleRef | null; stopped: string; world: unknown; origin: { x: number; y: number } | null; heading: { x: number; y: number } | null };
let poleDrag: PoleDrag | null = null;
let lastPoleGesture = 0;
function beginPoleDrag(proto: string, x: number, y: number, ghost: boolean) {
  const owner = poleOwner(game), old = game.poleReceipts[owner];
  const gesture = lastPoleGesture = Math.max(Date.now(), (old?.gesture || 0) + 1, lastPoleGesture + 1);
  poleDrag = { gesture, seq: 0, owner, proto, dir: view.rot as Dir, ghost, pending: true, anchor: null, stopped: '', world: game.world, origin: null, heading: null };
  lmb = true; drag = null;
  game.enqueue({ t: 'poleChain', op: 'start', gesture, seq: 0, proto, dir: poleDrag.dir, ghost, x, y });
}
function cancelPoleDrag(notify = true) {
  const d = poleDrag; poleDrag = null; view.polePlan = null;
  if (d && notify && d.world === game.world && d.owner === poleOwner(game)) game.enqueue({ t: 'poleChain', op: 'cancel', gesture: d.gesture, seq: d.seq + 1, proto: d.proto, dir: d.dir, ghost: d.ghost, x: 0, y: 0 });
}
function syncPoleDrag() {
  const d = poleDrag;
  if (!d) { view.polePlan = null; return; }
  if (d.world !== game.world || d.owner !== poleOwner(game)) { cancelPoleDrag(false); return; }
  if (!lmb || ui.open || view.tool || view.bp || !view.mouseIn || !view.cursor || ITEMS[view.cursor]?.place !== d.proto || game.peers[game.pl]?.off) { cancelPoleDrag(); return; }
  const receipt = game.poleReceipts[d.owner];
  if (d.pending && receipt?.gesture === d.gesture && receipt.seq >= d.seq) {
    d.pending = false; d.anchor = receipt.anchor;
    if (receipt.closed) d.stopped = receipt.reason || 'Цепочка опор остановлена';
  }
  const a = d.anchor && poleNode(game, d.anchor), p = PROTOS[d.proto];
  if (d.anchor && !a) d.stopped = 'Якорь цепочки удалён';
  const pointer = mouseTile(), w = d.dir % 2 ? p.h : p.w, h = d.dir % 2 ? p.w : p.h;
  const pos = [pointer[0] - w / 2, pointer[1] - h / 2];
  if (a) {
    d.origin ||= { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const dx = pointer[0] - d.origin.x, dy = pointer[1] - d.origin.y;
    if (d.heading && (Math.abs(dx * d.heading.y - dy * d.heading.x) > .5 || dx * d.heading.x + dy * d.heading.y < 0)) { d.origin = { x: a.x + a.w / 2, y: a.y + a.h / 2 }; d.heading = null; }
    const hx = pointer[0] - d.origin.x, hy = pointer[1] - d.origin.y, len = Math.hypot(hx, hy);
    if (!d.heading && len > .001) d.heading = { x: hx / len, y: hy / len };
  }
  const step = a ? nextPole(a, w, h, p.wire!, pos[0], pos[1], (x, y) => inspectPole(game, d.proto, d.dir, d.ghost, x, y), d.origin || undefined) : null;
  const label = d.stopped ? tr(d.stopped) : d.pending ? tr('Ожидание подтверждения опоры') :
    step && !step.ok ? tr(step.reason) : step?.shortened ? tr('Укороченный шаг') + ': ' + tr(step.reason) : tr('Шаг провода') + ': ' + Math.min(a?.wire || p.wire!, p.wire!) + ' · ' + tr('Зоны питания показаны отдельно');
  view.polePlan = { anchor: a || null, next: step ? { x: step.x, y: step.y, w: step.existing?.w || w, h: step.existing?.h || h, proto: step.existing?.proto || d.proto, dir: step.existing?.dir ?? d.dir, ok: step.ok && !d.stopped, ghost: d.ghost, shortened: step.shortened } : null, label };
  if (!d.pending && !d.stopped && a && pos && step?.reached) {
    d.seq++; d.pending = true;
    game.enqueue({ t: 'poleChain', op: 'extend', gesture: d.gesture, seq: d.seq, proto: d.proto, dir: d.dir, ghost: d.ghost, x: pos[0], y: pos[1], anchor: { id: a.id, ghost: a.ghost }, origin: d.origin || undefined });
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
  if (poleDrag && !(e.buttons & 1)) cancelPoleDrag();
  if (wallGridDrag) { const [wx, wy] = mouseTile(); wallGridDrag.ex = Math.floor(wx); wallGridDrag.ey = Math.floor(wy); wallGridDrag.ghost = e.shiftKey; }
  else if (railDrag) { const [wx, wy] = mouseTile(); railPlanTo(wx, wy, e.shiftKey); }
  else if (poleDrag) syncPoleDrag();
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
canvas.addEventListener('mouseleave', () => { view.mouseIn = false; cancelPoleDrag(); });
canvas.addEventListener('pointercancel', () => { cancelRailDrag(); cancelWallGridDrag(); cancelPoleDrag(); });
// macOS: Ctrl+щелчок (и щелчок с зажатым Ctrl на тачпаде) — это правая кнопка; браузер присылает button 0 + ctrlKey
let ctrlRmb = false;
const btnOf = (e: MouseEvent) => (IS_MAC && settings.ctrlClick && e.button === 0 && e.ctrlKey && !e.metaKey) ? 2 : e.button;
canvas.addEventListener('mousedown', ev => {
  audio.ensure();
  const b = btnOf(ev); ctrlRmb = b !== ev.button;
  const e = { button: b, shiftKey: ev.shiftKey, clientX: ev.clientX, clientY: ev.clientY };
  view.mouseX = e.clientX; view.mouseY = e.clientY;
  if (wallGridDrag && e.button === 2) { cancelWallGridDrag(); return; }
  if (poleDrag && e.button === 2) { cancelPoleDrag(); return; }
  if (railDrag && e.button === 2) { cancelRailDrag(); return; }
  const [wx, wy] = mouseTile(); const tx = Math.floor(wx), ty = Math.floor(wy); const ent = game.entAt(tx, ty);
  if (mp?.inGame && b === 0 && markMod(ev)) { game.enqueue({ t: 'mark', x: wx, y: wy }); altCombo = true; return; }
  if (b === 0 && !ent && !view.cursor && !view.tool && !view.bp && !quickMod(ev) && !cfgMod(ev)) {
    const hit = game.v117.drones.instances.map(d => ({ d, r: d.model === 'rocket' || d.model === 'tesla' ? .48 : .4, dist: Math.hypot(wx - d.x, wy - d.y) }))
      .filter(x => x.dist <= x.r).sort((a, b) => a.dist - b.dist || a.d.id - b.d.id)[0];
    if (hit) { view.selectedDroneId = hit.d.id; return; }
    view.selectedDroneId = null;
  }
  if (view.tool && (e.button === 0 || e.button === 2 && (view.tool === 'decon' || view.tool === 'upgrade'))) { view.sel = { x0: tx, y0: ty, x1: tx, y1: ty, cancel: e.button === 2 }; return; }
  if (view.bp) { if (e.button === 0) { lmb = true; pasteAt(bpPos()!); } else if (e.button === 2) takeBp(null); return; }
  if (quickMod(ev) && ent && (e.button === 0 || e.button === 2)) { const op = e.button === 0 ? 'load' : 'unload'; quickAt(ent.id, op, false); quickDrag = { op, seen: new Set([ent.id]) }; return; }
  if (game.held && ent && (e.button === 0 || e.button === 2)) { game.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: ent.id, n: e.button === 2 ? 'one' : 'all' }); return; }
  if (game.held?.instance && !ent && (e.button === 0 || e.button === 2)) { game.enqueue({ t: 'hand', op: 'drop', to: 'ground' }); return; }
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
  const wallProto = view.cursor ? ITEMS[view.cursor]?.place : null;
  if (e.button === 0 && wallProto && PROTOS[wallProto]?.type === 'wall' && wallGridMode === 'grid') {
    const [sx, sy] = mouseTile(); const x = Math.floor(sx), y = Math.floor(sy);
    wallGridDrag = { proto: wallProto, sx: x, sy: y, ex: x, ey: y, ghost: e.shiftKey }; view.wallPlan = null; lmb = true; return;
  }
  if (e.button === 0) {
    if (cfgMod(ev) && ent?.t === 'chest' && copiedChest) { game.enqueue({ t: 'chestSettings', id: ent.id, settings: copyChestSettings(copiedChest, ent.inv!.size) }); if (copiedCC?.t === 'chest') game.enqueue({ t: 'cset', id: ent.id, cc: copiedCC.cc }); game.msg('Настройки вставлены'); return; }
    if (cfgMod(ev) && ent && copiedCC && ent.t === copiedCC.t && ent.t !== 'assembler') { game.enqueue({ t: 'cset', id: ent.id, cc: copiedCC.cc }); game.msg('Настройки вставлены'); return; }
    if (cfgMod(ev) && ent && ent.t === 'assembler') { if (copiedRecipe !== null) game.enqueue({ t: 'setRecipe', id: ent.id, recipe: copiedRecipe }); if (copiedCC?.t === 'assembler') game.enqueue({ t: 'cset', id: ent.id, cc: copiedCC.cc }); return; }
    if (view.cursor === 'repair-pack') { lmb = true; return; }
    if (view.cursor && CAR_ITEMS[view.cursor]) { // v1.7: локомотив / вагон — на рельсы под курсором
      const q = carSpot(); if (!q) { game.msg('Ставится на рельсы'); return; }
      if (!game.inv.count(view.cursor)) { game.msg('Нет предмета: ' + ITEMS[view.cursor].name); return; }
      game.enqueue({ t: 'placeCar', proto: view.cursor, rail: q.rail, x: q.x, y: q.y, back: view.rot % 4 >= 2 }); return;
    }
    if (view.cursor && isRailProto(ITEMS[view.cursor]?.place || '')) { // v1.7: щелчок — один кусок, протягивание — путь
      const [sx, sy, sh] = railStart(wx, wy); railDrag = { sx, sy, sh, moved: false, tx: NaN, ty: NaN, tracks: 1, spacing: 4, generation: 0, forceGhost: e.shiftKey, plan: null }; lmb = true; return;
    }
    if (view.cursor) {
      const pole = ITEMS[view.cursor]?.place;
      if (pole && PROTOS[pole]?.type === 'pole' && Number.isFinite(PROTOS[pole].wire) && PROTOS[pole].wire! > 0) {
        const point = ghostPos()!, gh = e.shiftKey ? game.ghostAt(tx, ty) : null;
        const start = ent?.t === 'pole' ? [ent.x, ent.y] : gh && PROTOS[gh.proto]?.type === 'pole' ? [gh.x, gh.y] : point;
        beginPoleDrag(pole, start[0], start[1], e.shiftKey); return;
      }
      if (!game.inv.count(view.cursor)) { game.msg('Нет предмета: ' + ITEMS[view.cursor].name); }
      lmb = true; const g = ghostPos()!; drag = { x: g[0], y: g[1], dir: view.rot, placed: true }; tryBuildAt(g[0], g[1], false); return;
    }
    const car = !ent && game.trains.length ? carNear(game, wx, wy) : null;
    if (ent) ui.toggle('ent', ent.id);
    else if (car) ui.toggle('ent', car.id);
    else if (view.hoverWire != null && view.hoverWire >= 0) { const w = game.cw[view.hoverWire]; if (w) ui.openNet(w[0], wt(w, 0), w[2]); }
    lmb = true;
  } else if (e.button === 2) {
    if (cfgMod(ev) && ent?.t === 'chest') { copiedChest = { limit: ent.slotLimit ?? null, filters: (ent.filt || ent.inv?.filt || []).slice() }; copiedCC = { t: 'chest', cc: JSON.parse(JSON.stringify(ent.cc || {})) }; game.msg('Настройки сундука скопированы'); return; }
    if (cfgMod(ev) && ent && (hasOut(ent) || ent.t === 'combinator')) { copiedCC = { t: ent.t, cc: JSON.parse(JSON.stringify(ent.cc || {})) }; game.msg('Настройки комбинатора скопированы'); return; }
    if (cfgMod(ev) && ent && ent.t === 'assembler') { copiedRecipe = ent.recipe || null; copiedCC = ent.cc ? { t: 'assembler', cc: cleanCC(ent, ent.cc) || {} } : null; game.msg('Рецепт скопирован'); return; }
    rmb = true;
  }
});
window.addEventListener('mouseup', ev => { if (poleDrag && ev.button === 0) cancelPoleDrag(); if (wallGridDrag && ev.button === 0) {
    const d = wallGridDrag; view.mouseX = ev.clientX; view.mouseY = ev.clientY; const [wx, wy] = mouseTile(); d.ex = Math.floor(wx); d.ey = Math.floor(wy); wallGridDrag = null; view.wallPlan = null;
    const selected = view.cursor ? ITEMS[view.cursor]?.place : null;
    if (!ui.open && selected === d.proto && PROTOS[d.proto]?.type === 'wall') {
      try {
        const plan = wallGridPositions(d.sx, d.sy, d.ex, d.ey, wallGridStep, wallGridStagger);
        if (plan.overflow) game.msg(tr('За раз можно поставить не более 256 стен'));
        else if (plan.positions.length) game.enqueue({ t: 'wallBatch', proto: d.proto, positions: plan.positions, ghost: ev.shiftKey || d.ghost || undefined });
      } catch { game.msg(tr('Сетка стен отменена: координаты вне допустимого диапазона')); }
    }
  }
  if (railDrag && ev.button === 0) { const d = railDrag; view.mouseX = ev.clientX; view.mouseY = ev.clientY;
    const [wx, wy] = mouseTile(); railPlanTo(wx, wy, ev.shiftKey); railDrag = null;
    if (d.plan?.exact && d.plan.pieces.length) { const pcs = d.plan.pieces.filter(p => !p.have).map(p => ({ proto: p.proto, x: p.x, y: p.y, dir: p.dir })); if (pcs.length) game.enqueue({ t: 'railPath', pieces: pcs, ghost: ev.shiftKey || undefined }); else game.msg('Путь уже уложен'); }
    else if (!d.moved) { const g = ghostPos(); if (g) { if (!game.inv.count(view.cursor!)) game.msg('Нет предмета: ' + ITEMS[view.cursor!].name); tryBuildAt(g[0], g[1], false); } }
    else if (d.plan?.blocked) game.msg('Путь отменён: препятствие на трассе'); else game.msg('Путь не найден'); }
  floorDrag = null; const e = { button: ev.button === 0 && ctrlRmb ? 2 : ev.button }; if (ev.button === 0) ctrlRmb = false; if (view.sel && (e.button === 0) === !view.sel.cancel) finishSel(!!view.sel.cancel); if (e.button === 0) { lmb = false; drag = null; lastPaste = view.bp ? null : lastPaste; } if (e.button === 2) rmb = false; quickDrag = null; });
// колесо мыши — шаг 12% на щелчок; тачпад (прокрутка двумя пальцами и щипок) — плавно; щипок в Safari — жестами
const gestureActive = installGestures(canvas, () => view.zoom, z => { view.zoom = z; });
canvas.addEventListener('wheel', e => { e.preventDefault(); if (gestureActive()) return; view.zoom = wheelZoom(view.zoom, e, settings.wheel); }, { passive: false });
// v1.11: действие по сочетанию (два назначения на действие, кнопки мыши, Ctrl/Alt/Shift+клавиша)
function keyEv(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }, code: string): KeyEv { return { code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }; }
/** перехват назначения: клавиша / сочетание / кнопка мыши; Esc — отмена; модификатор один — по отпусканию */
let rebindMod = '';
function finishRebind(combo: string) {
  const act = ui.rebinding!; const slot2 = act.endsWith('#2'); const a = slot2 ? act.slice(0, -2) : act;
  if (combo) {
    for (const src of [settings.keys, settings.keys2]) for (const [o, c] of Object.entries(src)) if (c === combo && !(o === a && src === (slot2 ? settings.keys2 : settings.keys))) { src[o] = ''; ui.rebindNote = `«${keyName(combo)}» снято с «${ACTIONS.find(x => x[0] === o)?.[1] || o}»`; }
    (slot2 ? settings.keys2 : settings.keys)[a] = combo; saveSettings(settings);
  }
  ui.rebinding = null; rebindMod = ''; ui.render(true);
}
window.addEventListener('keydown', e => {
  audio.ensure();
  const k = evCode(e);
  if (poleDrag && k === 'Escape') { e.preventDefault(); cancelPoleDrag(); lmb = false; return; }
  if (wallGridDrag && k === 'Escape') { e.preventDefault(); cancelWallGridDrag(); return; }
  if (ui.rebinding) { e.preventDefault(); if (k === 'Escape') { finishRebind(''); return; } if (MOD_CODES.has(k)) { rebindMod = k; return; } finishRebind(comboOf(keyEv(e, k), k)); return; }
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') { if (ui.open && k === 'Escape') { e.preventDefault(); keys.clear(); ui.close(); } return; }
  if (ui.open && k !== 'Escape') {
    // v1.16: клавиша, открывшая окно (Tab — игроки, E — инвентарь…), закрывает это же окно; остальные клавиши окно по-прежнему не пропускает
    const own = actionOf(keyEv(e, k), settings.keys, settings.keys2), win = own === 'factory' ? 'fact' : own;
    if (win && win === ui.open && !ui.menuReturnTo && TOGGLE_WINS.has(win)) { e.preventDefault(); ui.close(); }
    return;
  }
  if (railDrag) {
    if (k === 'Escape') { e.preventDefault(); cancelRailDrag(); return; }
    if (/^Digit[1-4]$/.test(k)) { e.preventDefault(); railDrag.tracks = Number(k.slice(-1)); railDrag.spacing = adjustRailSpacing(railDrag.tracks, railDrag.spacing, 0); railDrag.plan = null; const [wx, wy] = mouseTile(); railPlanTo(wx, wy, e.shiftKey); return; }
    const spacingDirection = ['Equal', 'NumpadAdd', 'Key:+'].includes(k) ? 1 : ['Minus', 'NumpadSubtract', 'Key:-'].includes(k) ? -1 : 0;
    if (spacingDirection) { e.preventDefault(); railDrag.spacing = adjustRailSpacing(railDrag.tracks, railDrag.spacing, spacingDirection); railDrag.plan = null; const [wx, wy] = mouseTile(); railPlanTo(wx, wy, e.shiftKey); return; }
    if (k === 'ShiftLeft' || k === 'ShiftRight') { railDrag.plan = null; const [wx, wy] = mouseTile(); railPlanTo(wx, wy, true); }
  }
  if (k === 'AltLeft' || k === 'AltRight') { e.preventDefault(); if (!e.repeat) { altHeld = true; altCombo = false; } keys.add(k); return; }
  if (altHeld) altCombo = true;
  const act = actionOf(keyEv(e, k), settings.keys, settings.keys2);
  if (act && (e.altKey || e.ctrlKey || e.metaKey)) e.preventDefault(); // сочетание игры важнее сочетания браузера (Alt+D, Ctrl+D/S/F…)
  if (['F1', 'F3', 'F8', 'F9', 'Tab', 'Space', K('shoot'), K('pause'), K('debug')].includes(k)) e.preventDefault();
  keys.add(k);
  onAction(act, e.shiftKey, k, e);
});
const TOGGLE_WINS = new Set(['console', 'fact', 'help', 'bug', 'players', 'inv', 'tech', 'stats', 'map', 'bp', 'logi', 'trains', 'gear', 'swarm']);
/** выполнить действие (клавиатура или кнопка мыши) */
function onAction(a: string | null, shift: boolean, k: string, e: { preventDefault(): void; repeat?: boolean }) {
  if (a === 'droneAction' && !view.bp && !view.tool && view.selectedDroneId != null) {
    e.preventDefault();
    const d = game.v117.drones.instances.find(x => x.id === view.selectedDroneId);
    if (!d) { view.selectedDroneId = null; return; }
    game.enqueue({ t: 'v117', section: 'drones', op: d.mode === 'landed' || d.mode === 'disabled' ? 'recover' : 'return', droneId: d.id, opId: `ui-selected-drone-${game.tick}-${++selectedDroneActionSerial}` });
    return;
  }
  if (view.bp && (a === 'rotate' || a === 'pickup' || a === 'flipv')) {
    view.bp = a === 'rotate' ? (shift ? rotateBp(rotateBp(rotateBp(view.bp))) : rotateBp(view.bp)) : flipBp(view.bp, a === 'pickup'); lastBp = view.bp; return;
  }
  if (a && a.startsWith('hb')) { const [r, i] = a.slice(2).split('_').map(Number); if (r < ui.hotRows()) ui.selectHot(r * 10 + i); return; }
  if (a === 'copy' || a === 'cut') { e.preventDefault(); setTool(a); return; }
  if (a === 'paste') { e.preventDefault(); const b = lastBp || ui.bpLib()[0]?.bp; if (b) takeBp(b); else game.msg('Нет чертежа — сначала Ctrl+C'); return; }
  if (a === 'undo') { e.preventDefault(); game.enqueue({ t: shift && !settings.keys.undo.includes('Shift') ? 'redo' : 'undo' }); return; }
  if (a === 'redo') { e.preventDefault(); game.enqueue({ t: 'redo' }); return; }
  if (a === 'decon' || a === 'upgrade') { e.preventDefault(); setTool(a); return; }
  if (a === 'console') { e.preventDefault(); ui.toggle('console'); return; }
  if (a === 'gconsole') { e.preventDefault(); keys.clear(); ui.toggle('gcon'); setTimeout(() => document.getElementById('xcon-in')?.focus(), 60); return; }
  if (a === 'factory') { e.preventDefault(); ui.toggle('fact'); return; }
  if (a === 'help') { e.preventDefault(); ui.toggle('help'); return; }
  if (a === 'bug') { e.preventDefault(); ui.toggle('bug'); return; }
  if (a === 'players') { e.preventDefault(); ui.toggle('players'); }
  else if (a === 'chat' && (mp?.inGame || native?.connected)) { e.preventDefault(); keys.clear(); mpui!.openChat(); }
  else if (a === 'inv') ui.toggle('inv');
  else if (a === 'tech') ui.toggle('tech');
  else if (a === 'stats') ui.toggle('stats');
  else if (a === 'bio') { e.preventDefault(); bioSampleAction(); }
  else if (a === 'calc') { if (ui.open === 'calc') ui.close(); else ui.openCalc(null, 0, 'key'); }
  else if (a === 'map') ui.toggle('map');
  else if (a === 'bp') ui.toggle('bp');
  else if (a === 'logi') ui.toggle('logi');
  else if (a === 'trains') ui.toggle('trains');
  else if (a === 'gear') ui.toggle('gear');
  else if (a === 'swarm') ui.toggle('swarm');
  else if (a === 'nextGun') game.enqueue({ t: 'kit', op: 'next' });
  else if (a === 'ranges') { view.ranges = (((view.ranges || 0) + 1) % 3) as 0 | 1 | 2; game.msg(['Радиусы турелей: выкл.', 'Радиусы турелей: наведённая турель', 'Радиусы турелей: все видимые'][view.ranges]); }
  else if (a === 'holster') game.enqueue({ t: 'kit', op: 'holster' });
  else if (a === 'vehicle') game.enqueue({ t: 'vehicle' });
  else if (k === 'Escape' && game.held) game.enqueue({ t: 'hand', op: 'return' });
  else if (k === 'Escape') { if (view.bp || view.tool) { takeBp(null); setTool(null); } else if (view.cursor) view.cursor = null; else if (ui.open) ui.close(); else ui.toggle('menu'); }
  else if (a === 'rotate') {
    const [wx, wy] = mouseTile(); const ent = game.entAt(Math.floor(wx), Math.floor(wy));
    const n = view.cursor === 'curved-rail' ? 8 : 4; const car = !ent && game.trains.length ? carNear(game, wx, wy) : null;
    if (view.cursor === 'train-stop' && shift) { view.stationLeft = !(view.stationLeft === true); game.msg('Станция будет ' + (view.stationLeft ? 'слева' : 'справа') + ' от пути'); }
    else if (view.cursor) view.rot = (view.rot % n + (shift ? n - 1 : 1)) % n; else if (ent) game.enqueue({ t: 'rotate', id: ent.id, rev: shift }); else if (car) game.enqueue({ t: 'rotate', id: car.id });
  }
  else if (a === 'pipette') {
    if (game.held) game.enqueue({ t: 'hand', op: 'return' });
    else if (view.bp || view.tool) { takeBp(null); setTool(null); }
    else if (view.cursor) view.cursor = null;
    else { const [wx, wy] = mouseTile(); const ent = game.entAt(Math.floor(wx), Math.floor(wy)); if (ent) { view.cursor = ent.proto; view.rot = ent.dir; if (ent.t === 'stop') view.stationLeft = ent.stopLeft === true; } }
  }
  else if (a === 'pickup') game.enqueue({ t: 'pickup' });
  else if (a === 'pollution') { view.pollution = !view.pollution; game.msg(view.pollution ? 'Слой загрязнения: вкл' : 'Слой загрязнения: выкл'); }
  else if (a === 'debug' && shift) { profDetail = !profDetail; view.debug = true; if (sim) sim.post({ t: 'prof', detail: profDetail }); else game.prof.detail = profDetail; } // v1.9: Shift+F3 — замер по типам и чанкам
  else if (a === 'debug') view.debug = !view.debug;
  else if (a === 'pause' && mp?.inGame) { const s = mp.session!; if (s.isHost) s.pause(!s.paused); else game.msg('Паузу ставит только хост'); }
  else if (a === 'pause' || k === 'Pause') { if (native?.engaged) sim?.post({ t: 'pause', paused: !game.mpv?.mp?.paused }); else { paused = !paused; sim?.post({ t: 'pause', paused }); game.msg(paused ? 'Пауза' : 'Продолжаем'); } }
  else if (view.cursor && FLOOR_BY_ITEM[view.cursor] && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) {
    const up = k === 'Equal' || k === 'NumpadAdd'; view.brush = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, (view.brush || 1) + (up ? 1 : -1))); game.msg(`Кисть: ${view.brush}×${view.brush}`);
  }
  else if (view.debug && mp?.inGame && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) game.msg('Скорость в совместной игре не меняется');
  else if (view.debug && (k === 'Equal' || k === 'NumpadAdd')) { speed = Math.min(8, speed * 2); sim?.post({ t: 'speed', speed }); }
  else if (view.debug && (k === 'Minus' || k === 'NumpadSubtract')) { speed = Math.max(1, speed / 2); sim?.post({ t: 'speed', speed }); }
}
// v1.11: кнопки мыши 1 (средняя), 3 и 4 («назад»/«вперёд») — назначаемые; «назад» не уводит со страницы
const MOUSE_BTN = (b: number) => b === 1 || b === 3 || b === 4 ? 'Mouse' + b : '';
window.addEventListener('mousedown', ev => {
  const mc = MOUSE_BTN(ev.button); if (!mc) return;
  if (ui.rebinding) { ev.preventDefault(); ev.stopPropagation(); finishRebind(comboOf(keyEv(ev, mc), mc)); return; }
  if (editor.isOpen) return;
  ev.preventDefault(); keys.add(mc);
  if ((ev.target as HTMLElement).closest?.('#win input, #win textarea')) return;
  if (ui.open) { keys.delete(mc); return; }
  onAction(actionOf(keyEv(ev, mc), settings.keys, settings.keys2), ev.shiftKey, mc, ev);
}, true);
window.addEventListener('mouseup', ev => { const mc = MOUSE_BTN(ev.button); if (mc) { keys.delete(mc); ev.preventDefault(); } }, true);
window.addEventListener('auxclick', ev => { if (MOUSE_BTN(ev.button)) ev.preventDefault(); });
document.addEventListener('mousedown', () => { if (altHeld) altCombo = true; }, true); // Alt+щелчок (фильтры вагона) — не переключает режим деталей
window.addEventListener('keyup', e => { const kc = evCode(e); if (ui.rebinding && rebindMod && kc === rebindMod) { finishRebind(kc); return; } keys.delete(kc); if (railDrag && (kc === 'ShiftLeft' || kc === 'ShiftRight')) { railDrag.plan = null; const [wx, wy] = mouseTile(); railPlanTo(wx, wy, e.shiftKey); } if ((e.code === 'AltLeft' || e.code === 'AltRight') && altHeld) { altHeld = false; if (!altCombo) view.alt = !view.alt; e.preventDefault(); } });
window.addEventListener('blur', () => { cancelRailDrag(); cancelWallGridDrag(); cancelPoleDrag(); keys.clear(); lmb = rmb = false; altHeld = false; view.sel = null; });

// ---------- цикл ----------
const TICK_MS = 1000 / 60;
let acc = 0, last = performance.now(), fps = 0, fpsAcc = 0, fpsN = 0, tickMs = 0;
const minimap = document.getElementById('minimap') as HTMLCanvasElement;
document.getElementById('biosample-btn')?.addEventListener('click', ev => { ev.stopPropagation(); audio.ensure(); audio.play('ui'); bioSampleAction(); });
/** v1.11: большая карта по виду ui.mapv (масштаб и сдвиг на самой карте) + крестик выбранных для метки координат */
function drawBigMap() {
  const bm = document.getElementById('bigmap') as HTMLCanvasElement | null; if (!bm) return; const v = ui.mapv; if (v.follow) { v.cx = game.player.x; v.cy = game.player.y; }
  R.drawMap(game, bm, v.cx, v.cy, v.tpp, view.pollution); drawSpeakerMapMarkers(bm, v.cx, v.cy, v.tpp, true); drawFieldOv();
  ui.bioRoute.draw(bm, v.cx, v.cy, v.tpp);
  const d = ui.noteDraft; if (d.x !== '' && d.y !== '') { const c = bm.getContext('2d')!; const px = bm.width / 2 + (+d.x + 0.5 - v.cx) / v.tpp, py = bm.height / 2 + (+d.y + 0.5 - v.cy) / v.tpp; c.strokeStyle = '#ffd54a'; c.lineWidth = 2; c.beginPath(); c.moveTo(px - 8, py); c.lineTo(px + 8, py); c.moveTo(px, py - 8); c.lineTo(px, py + 8); c.stroke(); c.strokeRect(px - 3, py - 3, 6, 6); }
}
function drawSpeakerMapMarkers(canvas: HTMLCanvasElement, cx: number, cy: number, tpp: number, labels: boolean) {
  const c = canvas.getContext('2d'); if (!c) return;
  c.save(); c.font = 'bold 12px system-ui,sans-serif'; c.textBaseline = 'middle';
  for (const cfg of Object.values(game.v117.speakers.configs)) {
    if (!cfg.visual) continue;
    const e = game.ents.get(cfg.entityId); if (e?.proto !== 'programmable-speaker' || !e.active) continue;
    const x = canvas.width / 2 + (e.x + e.w / 2 - cx) / tpp, y = canvas.height / 2 + (e.y + e.h / 2 - cy) / tpp;
    if (x < -24 || y < -24 || x > canvas.width + 24 || y > canvas.height + 24) continue;
    c.fillStyle = '#a50024'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x - 4, y - 2); c.lineTo(x - 1, y - 2); c.lineTo(x + 3, y - 5); c.lineTo(x + 3, y + 5); c.lineTo(x - 1, y + 2); c.lineTo(x - 4, y + 2); c.closePath(); c.fill();
    c.beginPath(); c.arc(x + 1, y, 5, -0.85, 0.85); c.stroke();
    if (labels && cfg.label) { const text = cfg.label.slice(0, 64), w = Math.min(190, c.measureText(text).width + 10); c.fillStyle = 'rgba(0,0,0,.82)'; c.fillRect(x + 10, y - 9, w, 18); c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(text, x + 15, y, 180); }
  }
  c.restore();
}

/** v1.16 rc.7: контур поля и остаток разведанной части при наведении на большую карту (расчёт в воркере, на клиенте — только рисование) */
const fcs = { k: '', t: 0, busy: false, d: null as import('./sim/mgmt').FieldContour | null, in: new Set<number>(), timer: 0 };
const fcK = (x: number, y: number) => (y + 1e6) * 4e6 + (x + 1e6);
function drawFieldOv() {
  const ov = document.getElementById('bigov') as HTMLCanvasElement | null; if (!ov) return; const c = ov.getContext('2d')!; c.clearRect(0, 0, ov.width, ov.height);
  const h = ui.mapHover; const v = ui.mapv; if (!h || ui.open !== 'map') return;
  const known = game.world.hasChunk(Math.floor(h[0] / 32), Math.floor(h[1] / 32)) && game.world.res(h[0], h[1]) > 0; if (!known) return;
  const k = h[0] + ',' + h[1], now = performance.now(); const inside = !!fcs.d && fcs.in.has(fcK(h[0], h[1]));
  const want = !inside ? fcs.k !== k : now - fcs.t > 2500;
  if (want && !fcs.busy) {
    if (now - fcs.t < 130) { clearTimeout(fcs.timer); fcs.timer = window.setTimeout(drawFieldOv, 140); }
    else { fcs.busy = true; fcs.k = k; fcs.t = now; const q = sim ? sim.xq('fcont', { x: h[0], y: h[1] }) : Promise.resolve(xQuery(game, 'fcont', { x: h[0], y: h[1] }));
      q.then((d: any) => { fcs.busy = false; fcs.t = performance.now(); fcs.d = d; fcs.in = new Set(); if (d) for (let i = 0; i < d.runs.length; i += 3) for (let j = 0; j < d.runs[i + 2]; j++) fcs.in.add(fcK(d.runs[i] + j, d.runs[i + 1])); drawFieldOv(); }).catch(() => { fcs.busy = false; }); }
  }
  const d = fcs.d; if (!d || !inside) return;
  const sx = (x: number) => ov.width / 2 + (x - v.cx) / v.tpp, sy = (y: number) => ov.height / 2 + (y - v.cy) / v.tpp, s = 1 / v.tpp;
  c.lineWidth = 2; c.lineCap = 'butt';
  for (const fog of [false, true]) {
    c.beginPath(); c.strokeStyle = fog ? '#5cd6ff' : '#fff'; c.setLineDash(fog ? [4, 3] : []);
    for (let i = 0; i < d.segs.length; i += 3) { const f = d.segs[i + 2] >= 4; if (f !== fog) continue; const dd = d.segs[i + 2] & 3, x = sx(d.segs[i]), y = sy(d.segs[i + 1]);
      if (dd === 0) { c.moveTo(x, y); c.lineTo(x + s, y); } else if (dd === 2) { c.moveTo(x, y + s); c.lineTo(x + s, y + s); } else if (dd === 1) { c.moveTo(x + s, y); c.lineTo(x + s, y + s); } else { c.moveTo(x, y); c.lineTo(x, y + s); } }
    c.stroke();
  }
  c.setLineDash([]);
  const nm = ITEMS[d.item]?.name ?? d.item;
  const txt = d.oil ? `${nm}: дебит до ${d.yMax} % · ${d.cells} кл. (запас не убывает)${d.open ? ' · разведанная часть' : ''}` : `${nm}: разведанная часть — остаток ${d.remain} ед. · ${d.cells} кл.${d.open ? ' · поле уходит в неизвестное' : ''}`;
  const t = tr(txt); c.font = '12px system-ui,sans-serif'; const w = c.measureText(t).width + 12; const cx0 = sx(h[0] + 0.5); let tx = cx0 + 14, ty = sy(h[1] + 0.5) + 14; if (cx0 + 14 + w > ov.width * 0.7) tx = cx0 - w - 14; if (tx < 2) tx = 2; if (ty + 22 > ov.height) ty -= 40;
  c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(tx, ty, w, 20); c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(t, tx + 6, ty + 10);
}
ui.onMapHover = drawFieldOv;
ui.onMapDraw = drawBigMap;
// v1.11: колесо над мини-картой меняет её масштаб (сохраняется в настройках), щелчок открывает большую карту
minimap.addEventListener('wheel', e => { e.preventDefault(); settings.miniZoom = Math.max(0.25, Math.min(8, (settings.miniZoom || 1) * (e.deltaY < 0 ? 1 / 1.5 : 1.5))); saveSettings(settings); R.drawMap(game, minimap, game.player.x, game.player.y, settings.miniZoom, view.pollution); drawSpeakerMapMarkers(minimap, game.player.x, game.player.y, settings.miniZoom, false); }, { passive: false });
minimap.addEventListener('click', () => { if (ui.open !== 'map') ui.toggle('map'); });
let started = false;
/** v1.11: перезагрузка по кнопке игры (моды, язык) — без вопроса «покинуть страницу» */
let leaving = false;
/** шаги симуляции за прошедшее время; вызывается из кадра или — во фоновой вкладке — из таймера Worker'а */
let lastInput = '';
function readInput(typing: boolean): Extract<Command, { t: 'input' }> {
  const mx = typing ? 0 : (held('right') ? 1 : 0) - (held('left') ? 1 : 0), my = typing ? 0 : (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  let mine: { x: number; y: number } | null = null;
  if (rmb) { const [wx, wy] = mouseTile(); mine = { x: Math.floor(wx), y: Math.floor(wy) }; }
  let shoot: { x: number; y: number } | null = null, repair: number | null = null;
  if (held('shoot') && !typing) { const [wx, wy] = mouseTile(); shoot = { x: wx, y: wy }; }
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
  if (mainHost && mainHost.g !== game && (mainBase.length || game.scn?.script)) { mainHost.mods = [...mainBase, ...scnScript(game)]; mainHost.attach(game); }
  while (acc >= TICK_MS) {
    if (game.scriptWait && game.scriptWait()) { acc = Math.min(acc, TICK_MS * 3); break; } // v1.11: ждём ответы скриптов модов
    const mx = typing ? 0 : (held('right') ? 1 : 0) - (held('left') ? 1 : 0), my = typing ? 0 : (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
    let mine: { x: number; y: number } | null = null;
    if (rmb) { const [wx, wy] = mouseTile(); mine = { x: Math.floor(wx), y: Math.floor(wy) }; }
    let shoot: { x: number; y: number } | null = null, repair: number | null = null;
    if (held('shoot') && !typing) { const [wx, wy] = mouseTile(); shoot = { x: wx, y: wy }; }
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
ui.onOpen = w => {
  if (w === 'menu' && !menuPauseActive) {
    menuPauseActive = true; keys.clear();
    if (native?.engaged || native?.unresolvedHandoff) { /* Opening a client menu does not pause a dedicated world. */ }
    else if (mp?.inGame) { const session = mp.session!; menuWasMpPaused = session.paused; if (session.isHost && !session.paused) session.pause(true); }
    else { menuWasPaused = paused; paused = true; sim?.post({ t: 'pause', paused: true }); }
  } else if (w === null && menuPauseActive) {
    menuPauseActive = false; keys.clear();
    if (native?.engaged || native?.unresolvedHandoff) { /* Preserve the authority's pause state. */ }
    else if (mp?.inGame) { const session = mp.session!; if (session.isHost && !menuWasMpPaused && session.paused) session.pause(false); }
    else { paused = menuWasPaused; sim?.post({ t: 'pause', paused }); }
  }
  if (w) beta.winOpened(w); if (w === 'map') { ui.mapv.follow = true; setTimeout(drawBigMap, 0); } if (w === 'menu') fillSlotInfo();
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
  simulate(now, false); scnui.watch(game);
  syncSpeakerAudio();
  // звуки симуляции
  for (const s of game.sfx) { if (s.k === 'ralert' && settings.ruleSound === false) continue; audio.play(s.k, s.x - game.player.x, s.y - game.player.y); if (s.k === 'boom' && settings.shake) shake = Math.max(shake, 10 / (1 + Math.hypot(s.x - game.player.x, s.y - game.player.y) / 4)); if (s.k === 'launch' && settings.shake) shake = Math.max(shake, 6); }
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
  syncPoleDrag();
  if (game.rockets > seenRockets) { if (seenRockets === 0) ui.toggle('victory'); seenRockets = game.rockets; }
  if (view.cursor && view.ghostPos) {
    const pid = ITEMS[view.cursor].place!;
    view.ghostOk = game.inv.count(view.cursor) ? game.canPlace(pid, view.ghostPos[0], view.ghostPos[1], view.rot) : { ok: false, reason: 'Нет предмета в инвентаре' };
  } else view.ghostOk = null;
  if (view.cursor !== 'curved-rail' && view.cursor !== 'rail-signal' && view.cursor !== 'rail-chain-signal' && view.rot > 3) view.rot %= 4;
  // v1.7: план пути и призрак вагона
  const rd = railDrag; view.railPlan = rd && rd.plan ? (() => { const P = rd.plan!; const nS = P.pieces.filter(p => !p.have && p.proto === 'straight-rail').length, nC = P.pieces.filter(p => !p.have && p.proto === 'curved-rail').length;
    const trackCount = P.tracks, lastTwo = trackCount % 100, last = trackCount % 10;
    const trackForm = LANG === 'ru'
      ? last === 1 && lastTwo !== 11 ? 'путь' : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'пути' : 'путей'
      : trackCount === 1 ? 'путь' : 'пути';
    const laneLabel = `${trackCount} ${tr(trackForm)} · ${tr('шаг')} ${P.spacing}`;
    const materialLabel = `${nS} ${tr('прямых')} · ${nC} ${tr('кривых')}`;
    const blockedForm = LANG === 'ru'
      ? ruCountForm(P.blocked, 'заблокированный сегмент', 'заблокированных сегмента', 'заблокированных сегментов')
      : P.blocked === 1 ? 'заблокированный сегмент' : 'заблокированных сегментов';
    const unknownForm = LANG === 'ru'
      ? ruCountForm(P.unknown, 'сегмент в неоткрытом секторе', 'сегмента в неоткрытых секторах', 'сегментов в неоткрытых секторах')
      : P.unknown === 1 ? 'сегмент в неоткрытом секторе' : 'сегментов в неоткрытых секторах';
    const statusLabel = [P.blocked ? `${P.blocked} ${tr(blockedForm)}` : '', P.unknown ? `${P.unknown} ${tr(unknownForm)}` : '', P.ghosts ? `${P.ghosts} ${tr('призраков')}` : ''].filter(Boolean).join(' · ');
    const label = [laneLabel, materialLabel, statusLabel, P.exact ? '' : tr('путь не найден')].filter(Boolean).join(' · ');
    return { pieces: P.pieces, lanes: P.lanes, start: [rd.sx, rd.sy] as [number, number], end: [P.ex, P.ey] as [number, number], ok: P.exact, label, hint: tr('1–4: число путей · +/−: шаг · Esc: отмена') }; })() : null;
  const wd = wallGridDrag;
  if (wd && view.cursor && ITEMS[view.cursor]?.place === wd.proto && view.mouseIn) {
    const forceGhost = wd.ghost || keys.has('ShiftLeft') || keys.has('ShiftRight');
    let plan: ReturnType<typeof wallGridPositions> | null = null;
    try { plan = wallGridPositions(wd.sx, wd.sy, wd.ex, wd.ey, wallGridStep, wallGridStagger); } catch { /* cursor is outside the supported world envelope */ }
    if (!plan) view.wallPlan = { proto: wd.proto, positions: [], overflow: true, ghost: forceGhost, label: tr('Сетка стен отменена: координаты вне допустимого диапазона') };
    else if (plan.overflow) view.wallPlan = { proto: wd.proto, positions: [], overflow: true, ghost: forceGhost, label: tr('За раз можно поставить не более 256 стен') };
    else {
      const inv = game.inv.count(wd.proto); let available = inv, accepted = 0;
      const positions = plan.positions.map(([x, y]) => {
        if (!forceGhost && available < 1) return { x, y, ok: false, reason: 'Нет предмета в инвентаре' };
        if (!forceGhost && Math.hypot(x + .5 - game.player.x, y + .5 - game.player.y) > game.reach() + .5) return { x, y, ok: false, reason: 'Слишком далеко' };
        const loaded = game.world.hasChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
        if (forceGhost && !loaded) { accepted++; return { x, y, ok: null as boolean | null }; }
        const check = game.canPlace(wd.proto, x, y, 0, !forceGhost);
        const ok = check.ok && !game.ghostAt(x, y);
        if (ok) { accepted++; if (!forceGhost) available--; }
        return { x, y, ok, reason: game.ghostAt(x, y) ? 'Уже есть призрак' : check.reason };
      });
      view.wallPlan = { proto: wd.proto, positions, overflow: false, ghost: forceGhost, label: `${tr(forceGhost ? 'Призраки' : 'Можно поставить')}: ${accepted} / ${positions.length}` };
    }
  } else view.wallPlan = null;
  view.carGhost = view.cursor && CAR_ITEMS[view.cursor] && view.mouseIn ? (() => { const q = carSpot(); if (!q) { const [mx, my] = mouseTile(); return { proto: view.cursor!, x: mx, y: my, dx: 0, dy: -1, ok: false, reason: 'Ставится на рельсы' }; } const has = game.inv.count(view.cursor!) > 0; return { proto: view.cursor!, x: q.x, y: q.y, dx: q.dx, dy: q.dy, ok: has, reason: has ? undefined : 'Нет предмета в инвентаре' }; })() : null;
  if (view.railPlan || view.carGhost) view.ghostPos = null;
  if (view.cursor && !ITEMS[view.cursor]?.place && !CAR_ITEMS[view.cursor] && view.cursor !== 'repair-pack' && !FLOOR_BY_ITEM[view.cursor] && WIRE_OF[view.cursor] == null) view.cursor = null;
  if (view.cursor === 'repair-pack' && !game.inv.count('repair-pack')) view.cursor = null;
  R.beltItems = sim ? sim.beltItems : null;
  view.zones = ui.open === 'ent' && game.ents.get(ui.entId)?.t === 'roboport';
  view.fluidSelection = ui.open === 'ent' ? ui.entId : -1;
  view.fluidFocus = ui.open === 'ent' ? ui.fluidFocus : null;
  if (view.wireFrom != null && (!view.cursor || WIRE_OF[view.cursor] == null)) view.wireFrom = null;
  syncWallControls();
  R.draw(game, view, px, py);
  drawHeld();
  if (thumbReq.length) { const u = R.thumbnail(THUMB_W, THUMB_H); for (const f of thumbReq.splice(0)) f(u); }
  if (R.frame % 10 === 0) voice.watch(game.messages, game.goalIdx, i => GOALS[i]?.text || null, game.tick);
  ui.hud(); mpui?.hud(); updateBioHud(now);
  ui.hoverInfo(view.hoverEnt, view.mouseIn ? [tx, ty] : null, view.hoverWire);
  ui.sampleNet();
  if (R.frame % 20 === 0) { R.drawMap(game, minimap, game.player.x, game.player.y, settings.miniZoom || 1, view.pollution); drawSpeakerMapMarkers(minimap, game.player.x, game.player.y, settings.miniZoom || 1, false); }
  if (ui.open === 'map') { ui.bioRoute.tick(); if (R.frame % 30 === 1) drawBigMap(); }
  const dbg = document.getElementById('debug')!;
  if (view.debug) {
    let belts = 0, items = 0, stacks = 0; for (const e of game.ents.values()) if (e.lanes) { belts++; for (const s of e.lanes) for (const l of s) { items += l.length; for (const it of l) if (it.n > 1) stacks++; } }
    dbg.style.display = 'block';
    dbg.textContent = tr(`FPS ${fps.toFixed(0)} · тик ${tickMs.toFixed(2)} мс · ${sim ? `Worker, UPS ${sim.ups.toFixed(0)}` : 'главный поток'} ${sim ? ` · снимок ${sim.snapMs.toFixed(2)} мс в Worker, приём ${sim.applyMs.toFixed(2)} мс (целиком ${sim.nFull}, кратко ${sim.nDyn}, предметов ${sim.nItems})` : ''} · скорость ×${speed}${paused ? ' (пауза)' : ''}\nрендер ${R.mode}${R.gpuNote()} · средний слой ${R.stat.mid.toFixed(2)} мс · спрайтов ${R.stat.quads} · растеризовано ${R.stat.rast} (${R.stat.rastMs.toFixed(1)} мс) · вытеснений ${R.stat.evict}\nтик #${game.tick} · построек ${game.ents.size} · конвейеров ${belts} · предметов ${items} (стопок ${stacks}) · покрытий ${game.floors.size}${game.tileMarks.size ? ` (призраков ${game.tileMarks.size})` : ''}\nэлектросетей ${game.powerNets.size} · жидк. сетей ${game.fluidNets.length} · чанков ${game.world.chunks.size}${(() => { let r = 0, mx = 0, hx = 0; for (const e of game.ents.values()) { if (e.t === 'reactor') { r++; mx = Math.max(mx, heatTemp(e)); } else if (e.t === 'hexch') hx++; } return r || hx ? `\nтепло: реакторов ${r} · теплообменников ${hx} · макс. ${Math.round(mx)} °C · зон заражения ${game.nuc.zones.length}` : ''; })()}\nюнитов ${game.units.length} · групп ${game.groups.length} · эволюция ${(game.evolution * 100).toFixed(2)}% · текстуры ${texQuality()}px\n${(() => { const rv = robotView(game, ITEM_IDX); return `роботов в полёте ${rv.buf.length / ROBOT_STRIDE} (логистических ${(() => { let k = 0; for (let i = 3; i < rv.buf.length; i += ROBOT_STRIDE) if (rv.buf[i] & 8) k++; return k; })()}, видно ${R.stat.robots}) · сетей робопортов ${rv.nets.length} · подсистема роботов ${rv.ms.toFixed(3)} мс`; })()}\nсетей сигналов ${sim ? game.cstat[0] : game.cnets.length} · проводов ${game.cw.length} · комбинаторов ${sim ? game.cstat[3] ?? 0 : game.ccombs.length} · подсистема схемотехники ${(sim ? game.cstat[2] : circuitsMs()).toFixed(3)} мс\nпоездов ${sim ? game.tstat[0] : game.trains.length} · рельсов ${(() => { let k = 0; for (const e of game.ents.values()) if (e.t === 'rail') k++; return k; })()} · подсистема поездов ${(sim ? game.tstat[1] : trainMs).toFixed(3)} мс · светофоров ${(() => { let k = 0; for (const e of game.ents.values()) if (e.t === 'signal') k++; return k; })()} · блоков ${railGraph(game).nblk} (резервов ${game.trains.reduce((a, t) => a + (t.res?.length || 0), 0)})${(() => { const v = game.mpv?.mp; if (!v || !mp?.session) return ''; const st = mp.session.stats(); return `\nсеть: игрок ${v.me + 1} из ${v.n} · пинг ${mp.session.ping()} мс · задержка ввода ${v.delay} тиков · запас кадров ${v.buf} · ожидание ${v.wait} мс (простоев ${v.stalls}) · пакетов ${st.sent} (повторов ${st.resent}) · ${(st.out / 1024).toFixed(0)}/${(st.inn / 1024).toFixed(0)} КБ · подсистема сети (контрольная сумма) ${v.hashMs.toFixed(3)} мс`; })()}${profText()}${modsLine()}\nигрок ${game.player.x.toFixed(1)}, ${game.player.y.toFixed(1)} · seed ${game.seed} · день ${(game.daylight() * 100).toFixed(0)}%`);
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
  const startupChoice = worldChoice;
  await loadTextures();
  applySettings();
  const moved = await store.migrateFromLocal(Object.keys(getMeta())).catch(() => 0);
  if (moved) console.log('сохранений перенесено в IndexedDB:', moved);
  refreshStorageInfo();
  // v1.10: моды из IndexedDB — до загрузки партии (данные игры должны совпасть с сохранением)
  try { await mods.init(); if (mods.enabled().length && !BENCH) await applyModSet(false); else mods.dirty = false; } catch (e) { beta.log('error', 'mods: ' + (e as Error).message); }
  if (!BENCH) await native?.bootstrap(); // Register local data before accepting the authoritative remote world.
  for (const id of ['win', 'hotbar']) document.getElementById(id)!.addEventListener('mousedown', ev => { audio.ensure(); if ((ev.target as HTMLElement).closest('[data-act],[data-h],button')) audio.play('ui'); });
  const saves = listSaves().sort((a, b) => b.time - a.time);
  // Keep startup and the Esc pause route on the same navigation surface.
  const SEEN = 'zavod7:seenVersion'; let showUpdateNews = false;
  try { const seen = localStorage.getItem(SEEN); showUpdateNews = !!seen && seen !== beta.VERSION; localStorage.setItem(SEEN, beta.VERSION); } catch { /* без хранилища */ }
  if (BENCH) { /* эталонная база загрузится ниже */ }
  else if (startupChoice === worldChoice && saves.length) { if (await loadFrom(saves[0].slot, startupChoice) && startupChoice === worldChoice) game.msg('Продолжаем последнюю игру. Esc — меню.'); }
  else if (startupChoice === worldChoice) { if (sim) { sim.newGame(Math.floor(Math.random() * 1e9), 'normal'); game = sim.g; } else if (activeMods().length) game = new Game(Math.floor(Math.random() * 1e9)); intro(); }
  if (!BENCH && startupChoice === worldChoice) { ui.toggle('menu'); if (showUpdateNews) ui.openMenuChild('news'); }
  if ((BENCH || startupChoice === worldChoice) && gfxFirst && gfxFirst.why[0] !== '?gfx' && gfxFirst.preset !== 'high') game.msg(`Графика «${PRESET_NAMES[gfxFirst.preset]}» — подобрана под этот компьютер (${gfxFirst.why.join(', ')}). Изменить: Esc → Настройки`);
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
        if (BENCH_LEVEL && BENCH_LEVEL !== 2) { // v1.11: уровни 1, 3–5 строятся в Worker
          if (!sim) throw new Error('уровни замера 1, 3–5 — только с симуляцией в Worker (Esc → Настройки → Игра)');
          const info = await sim.perf(BENCH_LEVEL, BENCH_LEVEL >= 2 ? REF_BASE : null); benchState.info = info;
          const t0 = performance.now(); while (game.ents.size < info.ents * 0.9 && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
          view.zoom = 1;
        } else if (BENCH_MEGA) { // v1.9: мегабаза строится в Worker: эталонная база + ячейки с лентами (src/sim/megabase.ts)
          if (!sim) throw new Error('мегабаза — только с симуляцией в Worker');
          await sim.mega(REF_BASE, 165); const t0 = performance.now(); while (game.ents.size < 15000 && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200));
        } else await ui.h.loadSaveString(REF_BASE);
        ui.open = null; ui.toggle('perf');
      },
      setZoom: z => { view.zoom = z; }, frameCost: () => ({ n: frameN, ms: Array.from(frameCost) }), ups: () => sim ? sim.ups : 60, ents: () => game.ents.size,
      renderer: () => R.mode, rendererNote: () => R.modeNote, gpuName: () => gpuName(R.gameGL(), R.mode), preset: () => settings.gfx, settings: () => ({ ...settings, fpsCap: cap, tex: texQuality() }),
      progress: (t, f) => { benchState.text = tr(t); benchState.frac = f; const now = performance.now(); if (now - lastR > 500 && ui.open === 'perf') { lastR = now; ui.render(true); } },
      metrics: async (reset: boolean) => sim && BENCH_LEVEL ? sim.eval(`return g._perfMetrics ? g._perfMetrics(${reset}) : null`) : null,
    }, { ...(/[?&]benchfast=1/.test(location.search) ? { warm: 2, sec: 3 } : {}), mega: BENCH_MEGA || BENCH_LEVEL >= 4, level: BENCH_LEVEL || (BENCH_MEGA ? 0 : 2), info: () => benchState.info });
    beta.log('info', `bench: ${JSON.stringify(benchState.file.result)} gpu ${benchState.file.system.gpu}`);
  } catch (e) { benchState.text = tr('Замер не удался') + ': ' + (e as Error).message; beta.log('error', 'bench: ' + (e as Error).message); }
  benchState.running = false; settings.fpsCap = cap; if (ui.open !== 'perf') ui.toggle('perf'); else ui.render(true);
}
// PWA: только по http(s) — с file:// service worker и манифест недоступны
if (location.protocol.startsWith('http')) {
  const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker:', e));
}
(window as any).__zavod = { editor, scnui, R, beta, bench: benchState, frameCost: () => ({ n: frameN, ms: Array.from(frameCost.subarray(0, Math.min(256, frameN))) }), get game() { return game; }, sim, workerEval: (code: string) => sim ? sim.eval(code) : Promise.resolve(new Function('g', code)(game)), view, ui, takeBp, setTool, recipes: RECIPES, audio, voice, settings, store, saveTo, loadFrom, mp, mpui, mods, applyModSet };
void RECIPES; void (null as unknown as Entity);
