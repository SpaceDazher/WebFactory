// Пример скриптового мода ЗАВОД-7 (v1.11): «Авто-стройка печей вокруг руды».
// Когда игрок ставит бур на железную или медную руду, мод ставит печь на клетку выхода бура — печь берётся из
// инвентаря игрока (from_player). Команды применяются в следующем тике, поэтому печь появляется через 1/60 с,
// а счётчик растёт, когда приходит событие on_built самой печи (by === "script:auto-furnaces").
const FURNACES = ['stone-furnace', 'steel-furnace'];
const SMELT = { 'iron-ore': 1, 'copper-ore': 1 };

function defaults() {
  if (storage.on === undefined) storage.on = true;
  if (!storage.built) storage.built = 0;
  if (!storage.furnace) storage.furnace = 'stone-furnace';
}
function window_() {
  game.gui.open('main', {
    title: 'Авто-печи',
    elements: [
      { type: 'text', text: storage.on ? 'Включено: печь встанет перед новым буром на руде' : 'Выключено', style: storage.on ? 'ok' : 'dim' },
      { type: 'text', text: 'Поставлено печей: ' + storage.built },
      { type: 'text', text: 'Печь (щёлкните, чтобы выбрать):', style: 'dim' },
      { type: 'list', id: 'furnace', items: FURNACES.map(f => (f === storage.furnace ? '▶ ' : '') + (f === 'stone-furnace' ? 'Каменная печь' : 'Стальная печь')) },
      { type: 'row', children: [{ type: 'button', id: 'toggle', text: storage.on ? 'Выключить' : 'Включить' }, { type: 'button', id: 'hide', text: 'Скрыть' }] },
    ],
  });
}
// клетка печи 2×2 перед буром: выход бура drop_position, направление выхода = direction бура
function furnaceAt(e) {
  const p = e.entity.drop_position, d = e.entity.direction;
  if (d === 0) return { x: p.x, y: p.y - 1 };   // север
  if (d === 3) return { x: p.x - 1, y: p.y };   // запад
  return { x: p.x, y: p.y };                    // восток, юг
}

game.on_load(() => { defaults(); if (!storage.hidden) window_(); });

game.on_built(e => {
  const en = e.entity;
  if (e.by === 'script:auto-furnaces') { if (FURNACES.includes(en.name)) { storage.built++; if (storage.built === 1) game.print('Первая печь поставлена автоматически'); if (!storage.hidden) window_(); } return; }
  if (!storage.on || en.kind !== 'drill' || !en.drop_position || !SMELT[en.resource]) return;
  game.create_entity({ name: storage.furnace, position: furnaceAt(e), direction: 0, from_player: true, player: e.player_index });
});

game.on_gui_click(e => {
  if (e.gui !== 'main') return;
  if (e.element === 'toggle') { storage.on = !storage.on; window_(); }
  else if (e.element === 'hide' || e.element === '__close') { storage.hidden = true; game.gui.close('main'); game.print('Окно «Авто-печи» скрыто. Вернуть: поставьте деревянный сундук'); }
  else if (e.element === 'furnace') { storage.furnace = FURNACES[+e.value] || FURNACES[0]; window_(); }
});
// окно можно вернуть, поставив деревянный сундук (пример ещё одного события)
game.on_built(e => { if (storage.hidden && e.entity.name === 'wooden-chest' && e.by === 'player') { storage.hidden = false; window_(); } });
