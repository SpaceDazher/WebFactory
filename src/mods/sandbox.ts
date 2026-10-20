// v1.11: код песочницы скрипта мода — выполняется в отдельном Worker (в браузере — Web Worker из Blob, в Node —
// worker_threads). До запуска control.js убирает из глобального объекта (и его прототипов) сеть, хранилища, таймеры,
// создание кода из строк и вложенные Worker; Math.random и Date становятся детерминированными (сид партии, номер тика).
// Объявление обёртки — в workerSource(): код мода — тело функции, параметры которой затеняют require/process/self и т. п.
// ВНИМАНИЕ: строка ниже — обычный JS (не TypeScript), без обратных кавычек и «${».
export const SANDBOX_PRELUDE = String.raw`"use strict";
var __z7 = (function () {
  var G = typeof globalThis !== 'undefined' ? globalThis : self;
  var nodeReq = typeof require === 'function' ? require : null;
  var port, perfNow, memNow;
  if (nodeReq) {
    var pp = nodeReq('worker_threads').parentPort, v8 = nodeReq('v8'), ph = nodeReq('perf_hooks').performance;
    port = { post: function (m) { pp.postMessage(m); }, on: function (f) { pp.on('message', f); } };
    perfNow = function () { return ph.now(); }; memNow = function () { try { return v8.getHeapStatistics().used_heap_size; } catch (e) { return 0; } };
  } else {
    var sp = G.postMessage.bind(G), sa = G.addEventListener.bind(G), pf = G.performance;
    port = { post: function (m) { sp(m); }, on: function (f) { sa('message', function (e) { f(e.data); }); } };
    perfNow = function () { return pf.now(); }; memNow = function () { try { return (pf.memory && pf.memory.usedJSHeapSize) || 0; } catch (e) { return 0; } };
  }
  var BAN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'indexedDB', 'IDBFactory', 'caches', 'CacheStorage', 'importScripts',
    'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'MessagePort', 'WebTransport', 'RTCPeerConnection', 'Request', 'Response', 'Headers', 'navigator', 'location',
    'FileReader', 'FileReaderSync', 'Notification', 'postMessage', 'close', 'onmessage', 'onmessageerror', 'addEventListener', 'removeEventListener', 'dispatchEvent',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame', 'performance', 'crypto', 'Crypto',
    'storage', 'localStorage', 'sessionStorage', 'cookieStore', 'OffscreenCanvas', 'process', 'require', 'module', 'exports', 'Buffer', 'global', 'eval', 'Function',
    'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'fetchLater', 'scheduler', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream', 'FileSystemHandle', 'showOpenFilePicker'];
  for (var o = G; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (var i = 0; i < BAN.length; i++) { try { delete o[BAN[i]]; } catch (e) { /* */ } }
  for (var j = 0; j < BAN.length; j++) { try { Object.defineProperty(G, BAN[j], { value: undefined, writable: false, configurable: false }); } catch (e) { /* */ } }
  var noFn = function () { throw new Error('Создание кода из строки запрещено в модах'); };
  [function () {}, async function () {}, function* () {}, async function* () {}].forEach(function (f) { try { Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: noFn, writable: false, configurable: false }); } catch (e) { /* */ } });
  // детерминизм: случайность от сида партии, имени мода и номера тика; «время» — от номера тика
  var MOD = '', SEED = 0, curTick = 0, rs = 0, modHash = 0;
  function hashStr(s) { var h = 2166136261; for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return h | 0; }
  function rnd() { rs = (rs + 0x6D2B79F5) | 0; var t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  Math.random = rnd;
  var RD = Date, EPOCH = 1735689600000;
  var FD = function Date(a, b, c, d, e, f, g) { var n = arguments.length; if (!(this instanceof FD)) return new RD(FD.now()).toString(); return n === 0 ? new RD(FD.now()) : n === 1 ? new RD(a) : new RD(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0); };
  FD.now = function () { return EPOCH + Math.floor(curTick * 1000 / 60); }; FD.UTC = RD.UTC; FD.parse = RD.parse; FD.prototype = RD.prototype;
  try { Object.defineProperty(G, 'Date', { value: FD, writable: false, configurable: false }); } catch (e) { /* */ }
  var H = { load: [], tick: [], built: [], removed: [], research_finished: [], player_crafted: [], entity_died: [], chunk_generated: [], gui_click: [], gui_input: [] };
  var ops = null, early = [], subsDirty = true, lastStore = '{}';
  function str(v) { if (typeof v === 'string') return v; if (v instanceof Error) return v.message; try { var t = JSON.stringify(v); return t === undefined ? String(v) : t; } catch (e) { return String(v); } }
  var LINE0 = 0;
  function errText(e) {
    var m = (e && e.message) || String(e), st = (e && e.stack) || '';
    var mm = /:(\d+):(\d+)\)?\s*$/m.exec(st.split('\n').slice(1).join('\n')) || /:(\d+):(\d+)/.exec(st);
    if (mm) { var ln = +mm[1] - LINE0; if (ln > 0) m += ' (control.js:' + ln + ':' + mm[2] + ')'; }
    return m;
  }
  function out(op) { if (ops) ops.push(op); else early.push(op); }
  function log(level, args) { var a = []; for (var k = 0; k < args.length; k++) a.push(str(args[k])); out({ op: 'log', level: level, text: a.join(' ').slice(0, 2000) }); }
  function need(what) { if (!ops) throw new Error(what + ': команды можно давать только внутри обработчика события (game.on_…)'); }
  function P(x, y) { return { x: x, y: y, toString: function () { return '(' + x + ', ' + y + ')'; } }; }
  var DIRS = { north: 0, east: 1, south: 2, west: 3 };
  function dirOf(d) { if (typeof d === 'string') return DIRS[d] != null ? DIRS[d] : 0; return (((d | 0) % 4) + 4) % 4; }
  function target(t) { if (t === 'player' || t == null) return { target: 'player', pl: 0 }; if (typeof t === 'number') return { target: t | 0 }; if (t.player != null) return { target: 'player', pl: t.player | 0 }; if (t.id != null) return { target: t.id | 0 }; throw new Error('цель: "player", { player: n } или постройка { id }'); }
  function stack(s, n) { if (typeof s === 'string') return { item: s, n: n == null ? 1 : +n }; return { item: String(s.name), n: s.count == null ? 1 : +s.count }; }
  function on(k) { return function (fn, period) { if (typeof fn !== 'function') throw new Error('game.on_' + k + ': нужна функция'); H[k].push({ fn: fn, p: Math.max(1, Math.floor(+period || 1)) }); subsDirty = true; }; }
  var GUI_KIND = { text: 1, button: 1, list: 1, input: 1, row: 1 };
  function guiEl(el, depth) {
    if (!el || typeof el !== 'object') return { type: 'text', text: str(el) };
    var t = GUI_KIND[el.type] ? el.type : 'text', r = { type: t };
    if (el.id != null) r.id = String(el.id).slice(0, 64);
    if (el.text != null || el.caption != null) r.text = String(el.text != null ? el.text : el.caption).slice(0, 500);
    if (t === 'list') r.items = (Array.isArray(el.items) ? el.items : []).slice(0, 200).map(function (x) { return String(x).slice(0, 200); });
    if (t === 'input') { r.value = el.value == null ? '' : String(el.value).slice(0, 200); r.placeholder = el.placeholder == null ? '' : String(el.placeholder).slice(0, 80); }
    if (t === 'row' && depth < 3) r.children = (Array.isArray(el.children) ? el.children : []).slice(0, 20).map(function (c) { return guiEl(c, depth + 1); });
    if (el.style === 'ok' || el.style === 'err' || el.style === 'dim') r.style = el.style;
    return r;
  }
  var game = {
    storage: {},
    get tick() { return curTick; }, get mod() { return MOD; }, get seed() { return SEED; },
    random: function (a, b) { var r = rnd(); if (a == null) return r; if (b == null) return 1 + Math.floor(r * a); return a + Math.floor(r * (b - a + 1)); },
    on_load: on('load'), on_tick: on('tick'), on_built: on('built'), on_removed: on('removed'), on_research_finished: on('research_finished'),
    on_player_crafted: on('player_crafted'), on_entity_died: on('entity_died'), on_chunk_generated: on('chunk_generated'), on_gui_click: on('gui_click'), on_gui_input: on('gui_input'),
    print: function (text) { need('game.print'); ops.push({ op: 'print', text: str(text).slice(0, 300) }); },
    log: function () { log('info', arguments); },
    create_entity: function (o) { need('game.create_entity'); if (!o || !o.name || !o.position) throw new Error('game.create_entity({ name, position: { x, y }, direction?, from_player? })'); ops.push({ op: 'create', name: String(o.name), x: Math.floor(+o.position.x), y: Math.floor(+o.position.y), dir: dirOf(o.direction), fp: !!o.from_player, pl: o.player | 0 }); },
    remove_entity: function (e) { need('game.remove_entity'); ops.push({ op: 'remove', id: typeof e === 'object' && e ? e.id | 0 : e | 0 }); },
    insert: function (t, s, n) { need('game.insert'); var a = target(t), b = stack(s, n); ops.push({ op: 'insert', target: a.target, pl: a.pl, item: b.item, n: b.n }); },
    remove_item: function (t, s, n) { need('game.remove_item'); var a = target(t), b = stack(s, n); ops.push({ op: 'take', target: a.target, pl: a.pl, item: b.item, n: b.n }); },
    scenario: {
      win: function (text) { need('game.scenario.win'); ops.push({ op: 'scn', what: 'win', text: text == null ? '' : str(text).slice(0, 200) }); },
      fail: function (text) { need('game.scenario.fail'); ops.push({ op: 'scn', what: 'fail', text: text == null ? '' : str(text).slice(0, 200) }); }
    },
    gui: {
      open: function (id, spec) { need('game.gui.open'); spec = spec || {}; ops.push({ op: 'gui', id: String(id).slice(0, 64), pl: spec.player == null ? -1 : spec.player | 0, spec: { title: String(spec.title == null ? MOD : spec.title).slice(0, 80), elements: (Array.isArray(spec.elements) ? spec.elements : []).slice(0, 60).map(function (e) { return guiEl(e, 0); }) } }); },
      close: function (id, player) { need('game.gui.close'); ops.push({ op: 'guiclose', id: String(id).slice(0, 64), pl: player == null ? -1 : player | 0 }); }
    }
  };
  var con = { log: function () { log('info', arguments); }, info: function () { log('info', arguments); }, warn: function () { log('warn', arguments); }, error: function () { log('error', arguments); } };
  function subs() { var r = {}; for (var k in H) if (H[k].length) r[k] = k === 'tick' ? H.tick.map(function (h) { return h.p; }) : 1; return r; }
  function wrapEnt(en) { if (en && en.position) { en.position = P(en.position.x, en.position.y); if (en.drop_position) en.drop_position = P(en.drop_position.x, en.drop_position.y); } return en; }
  function storeOut() { try { var js = JSON.stringify(game.storage === undefined ? null : game.storage); if (js === undefined) js = 'null'; if (js !== lastStore) { lastStore = js; return js; } } catch (e) { out({ op: 'log', level: 'error', text: 'storage нельзя сохранить: ' + errText(e) }); } return null; }
  function batch(m) {
    curTick = m.tick; rs = (SEED ^ modHash ^ Math.imul(m.tick + 1, 0x9E3779B1)) | 0; ops = early.length ? early.splice(0) : [];
    var t0 = perfNow();
    for (var i = 0; i < m.evs.length; i++) {
      var ev = m.evs[i], list = H[ev.e]; if (!list || !list.length) continue;
      if (ev.entity) { wrapEnt(ev.entity); ev.position = ev.entity.position; }
      if (ev.area) ev.position = P(ev.area.x, ev.area.y);
      ev.tick = m.tick; ev.name = ev.name || ev.e;
      for (var k = 0; k < list.length; k++) { var h = list[k]; if (ev.e === 'tick' && m.tick % h.p) continue; try { h.fn(ev); } catch (e) { ops.push({ op: 'log', level: 'error', text: 'on_' + ev.e + ': ' + errText(e) }); } }
    }
    var st = storeOut(), ms = perfNow() - t0, res = ops; ops = null;
    var msg = { t: 'ops', tick: m.tick, ops: res, ms: ms, st: st, sl: lastStore.length, mem: memNow() };
    if (subsDirty) { subsDirty = false; msg.subs = subs(); }
    port.post(msg);
  }
  return {
    start: function (main, line0) {
      LINE0 = line0;
      port.on(function (m) {
        if (m.t === 'init') {
          MOD = m.mod; SEED = m.seed | 0; curTick = m.tick | 0; modHash = hashStr(MOD); rs = (SEED ^ modHash) | 0;
          try { game.storage = m.storage ? JSON.parse(m.storage) : {}; } catch (e) { game.storage = {}; }
          lastStore = JSON.stringify(game.storage); var t0 = perfNow();
          try { main(game, game.storage, con); } catch (e) { port.post({ t: 'fail', text: errText(e) }); return; }
          subsDirty = false; port.post({ t: 'ready', subs: subs(), logs: early.splice(0), ms: perfNow() - t0, mem: memNow() });
        } else if (m.t === 'ev') batch(m);
      });
    }
  };
})();
`;
/** строки до начала кода мода (для номеров строк в ошибках) */
const HEAD = '__z7.start(function (game, storage, console, require, module, exports, process, global, globalThis, self, window, __filename, __dirname, importScripts, fetch, XMLHttpRequest, WebSocket, indexedDB, caches, Worker, navigator, postMessage, Function) {\n"use strict";\n';
/** исходный код Worker мода: песочница + control.js. Динамический import() запрещён проверкой исходника (checkScript) */
export function workerSource(code: string): string {
  const pre = SANDBOX_PRELUDE + HEAD; const line0 = pre.split('\n').length - 1;
  return pre + code + '\n}, ' + line0 + ');\n';
}
/** проверка исходника до запуска: import() и import … обходят песочницу (загрузка кода по сети) */
export function checkScript(code: string): string | null {
  if (code.length > 2_000_000) return 'control.js больше 2 МБ';
  if (/\bimport\s*[(.]/.test(code) || /^\s*import\s/m.test(code) || /^\s*export\s/m.test(code)) return 'control.js: import/export запрещены — весь код мода в одном файле (динамическая загрузка кода по сети недоступна)';
  if (/\bimport\b/.test(code.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) return 'control.js: слово import вне строк запрещено (динамическая загрузка кода)';
  return null;
}
