// v1.9: заметки на карте — текст с заголовком в точке мира (расчёт калькулятора сохраняется сюда же). Команда note —
// через очередь команд (в совместной игре заметки общие). Сохраняются в партии (формат 13).
import type { Game } from './game';
import { tele } from './telemetry';
import { ITEMS } from '../data/items';

export interface MapNote { id: number; x: number; y: number; title: string; text: string; tick: number; pl?: number; /** stable item ID, omitted for legacy/plain flags */ icon?: string; }
export const NOTE_MAX = 200, NOTE_TEXT = 4000, NOTE_TITLE = 60;
const clean = (v: any, n: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
export function validNoteIcon(id: unknown): id is string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(id) || /^(?:https?|javascript|data|blob):/i.test(id) || !Object.prototype.hasOwnProperty.call(ITEMS, id)) return false;
  const it = ITEMS[id];
  return !!it && it.id === id && typeof it.name === 'string' && typeof it.icon === 'string' && typeof it.color === 'string'
    && typeof it.group === 'string' && Number.isInteger(it.stack) && it.stack > 0 && Number.isFinite(it.order)
    && !it.fluid && !it.virtual && !it.meta;
}
export function noteCmd(g: Game, c: { op: string; id?: number; x?: number; y?: number; text?: string; title?: string; icon?: string | null }) {
  if (c.icon !== undefined && c.icon !== null && !validNoteIcon(c.icon)) return;
  if (c.op === 'add') {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || g.notes.length >= NOTE_MAX) return;
    const n: MapNote = { id: g.nextNote++, x: Math.round(c.x! * 2) / 2, y: Math.round(c.y! * 2) / 2, title: clean(c.title, NOTE_TITLE) || 'Заметка', text: clean(c.text, NOTE_TEXT), tick: g.tick, ...(validNoteIcon(c.icon) ? { icon: c.icon } : {}) };
    if (g.peers.length) n.pl = g.pl;
    g.notes.push(n); g.noteVer++; tele.note(g, n.title.startsWith('🧮')); g.msg('Заметка добавлена на карту: ' + n.title);
  } else if (c.op === 'edit') {
    const n = g.notes.find(x => x.id === c.id); if (!n) return;
    if (c.title != null) n.title = clean(c.title, NOTE_TITLE) || n.title; if (c.text != null) n.text = clean(c.text, NOTE_TEXT);
    if (Number.isFinite(c.x) && Number.isFinite(c.y)) { n.x = Math.round(c.x! * 2) / 2; n.y = Math.round(c.y! * 2) / 2; }
    if (c.icon === null) delete n.icon; else if (c.icon !== undefined) n.icon = c.icon;
    g.noteVer++;
  } else if (c.op === 'del') { const i = g.notes.findIndex(x => x.id === c.id); if (i >= 0) { g.notes.splice(i, 1); g.noteVer++; } }
}
/** проверка заметок из сохранения (битые — отбрасываются) */
export function cleanNotes(a: any): MapNote[] {
  if (!Array.isArray(a)) return [];
  const out: MapNote[] = [];
  for (const n of a.slice(0, NOTE_MAX)) if (n && Number.isFinite(n.id) && Number.isFinite(n.x) && Number.isFinite(n.y)) out.push({ id: n.id | 0, x: +n.x, y: +n.y, title: clean(n.title, NOTE_TITLE) || 'Заметка', text: clean(n.text, NOTE_TEXT), tick: Number.isFinite(n.tick) ? n.tick : 0, ...(Number.isFinite(n.pl) ? { pl: n.pl | 0 } : {}), ...(validNoteIcon(n.icon) ? { icon: n.icon } : {}) });
  return out;
}
