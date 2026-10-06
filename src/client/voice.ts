// Озвучка (п. 6 плана 1.0): голос ОСКАРа и интерфейса через синтез речи браузера (Web Speech API).
// Если голоса для языка нет (или нет speechSynthesis), ОСКАР «говорит» синтезированными слогами (GameAudio.babble).
// Говорит только после первого жеста игрока (требование браузеров) и не говорит в фоновой вкладке.
import type { GameAudio } from './audio';
import type { Settings } from './settings';
import { tr, LANG } from '../core/i18n';

export type VoiceKind = 'oscar' | 'ui';
export interface Spoken { kind: VoiceKind; text: string; engine: 'speech' | 'babble'; voice: string; at: number; }
interface Job { kind: VoiceKind; text: string; }
const MAX_QUEUE = 4;

/** Текст для произнесения: перевод, без эмодзи и значков, сокращения — словами */
export function speakable(text: string, lang: 'ru' | 'en' = LANG): string {
  let t = tr(text).replace(/^(ОСКАР|OSCAR):\s*/, '');
  // \b в JS не работает с кириллицей — границы слов через lookaround
  const W = (w: string) => new RegExp(`(?<![А-Яа-яЁё\\w])${w}(?![А-Яа-яЁё\\w])`, 'g');
  const ru: [RegExp, string][] = [[W('ПКМ'), 'правая кнопка'], [W('ЛКМ'), 'левая кнопка'], [W('МВт'), 'мегаватт'], [W('кВт'), 'киловатт'], [W('НПЗ'), 'эн пэ зэ'], [/(\d)\s?с(?![А-Яа-яЁё])/g, '$1 секунд'], [W('шт'), 'штук']];
  const en: [RegExp, string][] = [[/\bRMB\b/g, 'right click'], [/\bLMB\b/g, 'left click'], [/\bMW\b/g, 'megawatts'], [/\bkW\b/g, 'kilowatts']];
  for (const [re, w] of lang === 'ru' ? ru : en) t = t.replace(re, w);
  return t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}⚠✔✘☑☐●]/gu, '').replace(/[«»“”"]/g, '').replace(/\s*[×→]\s*/g, ' ').replace(/\(([^)]*)\)/g, ', $1,').replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/,+/g, ',').replace(/,\s*([.!?])/g, '$1').replace(/,\s*$/, '').trim();
}
/** Какие сообщения игры озвучивать: oscar — голосом ОСКАРа, important — при «важном», остальное — при «всё» */
export function classify(text: string): VoiceKind | 'important' | 'other' {
  if (/^ОСКАР:/.test(text)) return 'oscar';
  if (/^⚠|^Исследовано|^Инженер погиб|^Новый инженер|^Ракета стартует|^Сохранено|^Ошибка|^Игра загружена|^Сохранение .* загружено|^Низкий FPS/.test(text)) return 'important';
  return 'other';
}

export class Voice {
  log: Spoken[] = [];
  private q: Job[] = []; private busy = false; private timer = 0; private unlocked = false;
  private seen = new Set<string>(); private lastGoal = -1; private quietUntil = 0; private recent = new Map<string, number>();
  constructor(private audio: GameAudio, private st: () => Settings) {
    const ss = this.ss(); if (ss && 'onvoiceschanged' in ss) ss.addEventListener?.('voiceschanged', () => { /* список голосов в Chrome приходит позже */ });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }
  private ss(): SpeechSynthesis | null { return typeof speechSynthesis !== 'undefined' ? speechSynthesis : null; }
  /** вызвать на первом жесте пользователя */
  unlock() { this.unlocked = true; }
  get ready() { return this.unlocked; }
  /** голоса браузера для текущего языка */
  voices(): SpeechSynthesisVoice[] { const ss = this.ss(); if (!ss) return []; const pre = LANG === 'ru' ? 'ru' : 'en'; return ss.getVoices().filter(v => v.lang.toLowerCase().startsWith(pre)); }
  pick(): SpeechSynthesisVoice | null {
    const vs = this.voices(); if (!vs.length) return null; const name = this.st().voiceName;
    return vs.find(v => v.name === name) || vs.find(v => v.localService) || vs[0];
  }
  /** название голоса для настроек */
  engineName(): string { const v = this.pick(); return v ? `${v.name} (${v.lang})` : ''; }
  say(text: string, kind: VoiceKind = 'oscar', force = false) {
    const s = this.st(); if (!force && (!this.unlocked || (typeof document !== 'undefined' && document.hidden))) return;
    if (s.voice <= 0 || s.master <= 0) return;
    const t = speakable(text); if (!t) return;
    const now = Date.now(); if (!force && now - (this.recent.get(t) || 0) < 6000) return; this.recent.set(t, now);
    if (this.recent.size > 200) this.recent.clear();
    // ОСКАР важнее: при переполнении выбрасываем реплики интерфейса, потом самые старые
    if (this.q.length >= MAX_QUEUE) { const i = this.q.findIndex(j => j.kind === 'ui'); this.q.splice(i >= 0 ? i : 0, 1); }
    if (kind === 'ui' && this.q.length >= 2) return;
    this.q.push({ kind, text: t }); this.next();
  }
  stop() { this.q.length = 0; this.ss()?.cancel(); this.busy = false; clearTimeout(this.timer); }
  private next() {
    if (this.busy) return; const j = this.q.shift(); if (!j) return; this.busy = true;
    const s = this.st(); const vol = s.master * s.voice;
    const done = () => { if (!this.busy) return; this.busy = false; clearTimeout(this.timer); setTimeout(() => this.next(), 120); };
    const v = this.pick(); const ss = this.ss();
    if (j.kind === 'oscar') this.audio.play('oscar');
    if (ss && v && typeof SpeechSynthesisUtterance !== 'undefined') {
      const u = new SpeechSynthesisUtterance(j.text); u.voice = v; u.lang = v.lang; u.volume = Math.min(1, vol);
      u.rate = (j.kind === 'oscar' ? 1.0 : 1.15) * s.voiceRate; u.pitch = j.kind === 'oscar' ? 0.75 : 1.0;
      u.onend = done; u.onerror = done; this.log.push({ kind: j.kind, text: j.text, engine: 'speech', voice: v.name, at: Date.now() });
      // onend в некоторых браузерах теряется — страховка по длине текста
      this.timer = window.setTimeout(done, 2500 + j.text.length * 110 / s.voiceRate);
      setTimeout(() => ss.speak(u), j.kind === 'oscar' ? 180 : 0);
    } else {
      const ms = j.kind === 'oscar' ? this.audio.babble(j.text, vol, true) : 0; // интерфейс без голоса браузера — молча (значки и звуки уже есть)
      this.log.push({ kind: j.kind, text: j.text, engine: 'babble', voice: '', at: Date.now() });
      this.timer = window.setTimeout(done, Math.max(200, ms + 250));
    }
    if (this.log.length > 100) this.log.splice(0, 50);
  }
  /** новая партия или загрузка: старые сообщения не озвучиваем */
  reset() { this.seen.clear(); this.lastGoal = -1; this.quietUntil = Date.now() + 1500; this.stop(); }
  /** раз в несколько кадров: новые сообщения и смена цели ОСКАРа */
  watch(messages: { text: string; tick: number }[], goalIdx: number, goalText: (i: number) => string | null, tick: number) {
    const s = this.st();
    // смена цели сразу после загрузки или новой партии — не новость
    if (Date.now() < this.quietUntil || this.lastGoal < 0) { this.lastGoal = goalIdx; }
    if (!this.unlocked) return; // до первого жеста ничего не отмечаем: свежие реплики прозвучат, когда игрок щёлкнет
    for (const m of messages) {
      const k = m.tick + '|' + m.text; if (this.seen.has(k)) continue; this.seen.add(k);
      if (tick - m.tick > 600) continue; // старше 10 с — уже неактуально
      const c = classify(m.text);
      if (c === 'oscar') { if (!/цель выполнена/.test(m.text)) this.say(m.text, 'oscar'); else this.say(m.text.replace(/ — .*/, ''), 'oscar'); }
      else if (s.uiVoice === 'all' || (s.uiVoice === 'important' && c === 'important')) this.say(m.text, 'ui');
    }
    if (this.seen.size > 400) this.seen = new Set(messages.map(m => m.tick + '|' + m.text));
    if (goalIdx !== this.lastGoal) {
      if (this.lastGoal >= 0 && goalIdx > this.lastGoal) { const t = goalText(goalIdx); if (t) this.say((LANG === 'ru' ? 'Новая цель: ' : 'New goal: ') + tr(t), 'oscar'); }
      this.lastGoal = goalIdx;
    }
  }
}
