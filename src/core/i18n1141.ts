// v1.14.1: английские строки обновления — переподключение, сторожки передачи мира, модули брони MK3.
export const EN1141: Record<string, string> = {
  'Вы вышли из совместной игры: загружено сохранение': 'You left the multiplayer session: a save was loaded',
  'создаст новый код-запрос — отправьте его хосту, он вставит его в «Игроки → Настройки хоста и приглашения» и пришлёт ответ': 'will create a new request code — send it to the host, who pastes it into “Players → Host settings and invitations” and sends back a reply',
  'Причина: ': 'Reason: ',
  'Связь с хостом потеряна (15 с нет данных)': 'Connection to the host lost (no data for 15 s)',
  'Связь потеряна — переподключаемся… попытка ': 'Connection lost — reconnecting… attempt ',
  'Нет связи с хостом — нажмите здесь, чтобы переподключиться': 'No connection to the host — click here to reconnect',
  'Сервер сигналинга отключился — пробую подключиться снова…': 'The signaling server went away — trying to reconnect…',
  'Сервер сигналинга недоступен — новые игроки могут войти только по кодам вручную': 'The signaling server is unavailable — new players can only join with manual codes',
  'Не удалось подготовить мир: ': 'Could not prepare the world: ',
  'Передача мира остановилась (не приходят данные от хоста)': 'World transfer stalled (no data from the host)',
  'Батарея, энергощит, личный лазер, экзоскелет, робопорт и реактор MK3 — ещё мощнее MK2': 'Battery, energy shield, personal laser, exoskeleton, roboport and reactor MK3 — even stronger than MK2',
  'Модули брони MK3': 'Armor modules MK3', 'Портативный реактор MK3': 'Portable reactor MK3', 'Батарея брони MK3': 'Armor battery MK3', 'Энергощит MK3': 'Energy shield MK3',
  'Личный лазер MK3': 'Personal laser MK3', 'Личный робопорт MK3': 'Personal roboport MK3', 'Экзоскелет MK3': 'Exoskeleton MK3',
  // «Что нового» 1.14.1
  'Мультиплеер: исправления': 'Multiplayer fixes',
  'Вход к хосту больше не застревает на «Загрузка мира 0%»: большие миры (из сохранения или после долгой игры) теряли первый же кусок при передаче — теперь они собираются целиком': 'Joining a host no longer gets stuck on “Loading world 0%”: large worlds (from a save or after a long game) lost their first piece in transit — they are now reassembled in full',
  'Из сохранения можно играть вдвоём и втроём: хост загружает партию, игроки входят по коду, в том числе в уже идущую игру': 'Saved games can be played with two or three players: the host loads the save and players join by code, including into a game already in progress',
  'После обрыва связи игра сама пытается вернуться (до 6 попыток), а в окне «Совместная игра» и на плашке внизу есть кнопка «Переподключиться»; персонаж и инвентарь ждут 5 минут': 'After a dropped connection the game tries to return by itself (up to 6 attempts), and the Multiplayer window and the bottom plate have a “Reconnect” button; your character and inventory wait for 5 minutes',
  'Хост, потерявший сервер сигналинга, подключается снова и занимает прежний код комнаты; зависшая передача мира обрывается с понятной причиной, а не висит': 'A host that lost the signaling server reconnects and takes its old room code; a stalled world transfer is aborted with a clear reason instead of hanging',
  'Загрузка сохранения или новая партия посреди совместной игры корректно выходят из сеанса; ошибка подготовки мира у хоста показывается, а не теряется': 'Loading a save or starting a new game in the middle of a session now leaves the session cleanly; a host’s world-preparation error is shown instead of being lost',
  'Модули брони MK3: реактор, батарея, энергощит, личный лазер, робопорт и экзоскелет (технология «Модули брони MK3»)': 'Armor modules MK3: reactor, battery, energy shield, personal laser, roboport and exoskeleton (the “Armor modules MK3” technology)',
};
