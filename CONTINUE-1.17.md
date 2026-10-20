> Дополнительная приёмка после архивов dev.1: исправлены native server/relay/WebSocket. Повторный точный `npm test` на текущем коде завершился0; типы/native-поставка, отдельный Edge E2E34–38, прямой и TLS-relay16клиентов, реальный перезапуск шлюза/отзыв приглашения, browser landing/повторный вход/движение, RTC и сценарий+мод на dedicated приняты. Свидетельства: `logs/acceptance-20261020/`, `docs/RELEASE-ACCEPTANCE-20261020.md`. Подготовлен бесплатный Render; пользователь подключает аккаунт/репозиторий. SpaceDazher/WebFactory main пока1.10, перенос опубликован в ветке `codex/v117-render-free`, main не менялась. Публичный URL/интернет, чистая установка,24ч/16игроков и массовые/ручные условия не приняты; весь выпуск1.17 не завершён.
# Current phase: unified verification (20 Oct)

Source implementation is now a closure candidate; checks have started. See docs/RESUMED-20261020.md and logs/verify-20261019/. Chromium E2E34–38 exited0. Bundled-runtime RTC and forced WebSocket/EN, native lifecycle and world identity checks have passed targeted runs. The final build/type/native/full-npm pipeline completed on20Oct with observed exit0; npm-test.exit.txt is0. The exact full npm test passed, including6279 localization strings. This is the final tested dev.1 code; source/tests did not change during the run. See CHECKS-1.17-dev.md for evidence and unaccepted release criteria. Earlier source-only/no-check instructions below are historical and superseded. No whole-update acceptance or public deployment is claimed.

# Продолжение 1.17: полная реализация, dev.1

Активная версия: `1.17.0-dev.1`, формат мира 21. Рабочая папка:
`D:/Project/webfactory/work-v117-implementation-20261015`. Защищённая база:
`D:/Project/webfactory/work-v117-alpha5-20261015`; первые 341 определения
предметов и их индексы сохраняются. Последний перенос 1.16 сверяется с
`D:/Project/webfactory/work-v116-rail-map-patch-20261016`, без замены файлов
целиком и отката формата21. Базы и прежние архивы не изменять.

**Последняя инструкция пользователя: сначала закончить все пункты ТЗ,
затем тестировать и исправлять по результатам.** Реализация перешла в общую
проверку 19 октября. Build/typecheck, отдельные тесты и native bootstrap уже
проходили; точный полный npm test завершился 20 октября с наблюдаемым exit 0 (6279 строк RU/EN). Проверки исторической
alpha.5 ниже не относятся к текущему dev-кандидату.

Читать актуальные `docs/PLAN-1.17-FULL.md`, `SPEC-1.17.md`,
`IMPLEMENTATION-STATUS-1.17.md`, `RESUMED-20261017.md`, `RESUMED-20261018.md`, `RESUMED-20261019.md`,
`REVIEW-1.17-STATIC-20261017.md` и `NATIVE-SERVER-IMPLEMENTATION-1.17.md`.
Резервная копия до продолжения:
`D:/Project/webfactory/artifacts/.v117-before-resume-20261017.zip`, SHA-256:
`77D399676766A4804E4827CCE432F94DA5AD48B4D8E7A2ED3CAD122D3A3762D3`.
Это исходная копия перед последними правками, не сборка текущего результата.

Исполнитель `/root/v117_resume_full`, gpt-6-luna/max, остановился по лимиту
использования; работу продолжает родитель. Не создавать ему замену и не
считать полный этап принятым по отдельным сообщениям. Сохранить внесённые
родителем §8/§11 и все последующие исправления.

Продолжение 18 октября описано в `docs/RESUMED-20261018.md`.
Физический перенос/отрисовка дронов, основные пути покрытий/ближнего боя и
расстановка опор подключены в исходниках, но не приняты запуском.
Исполнитель завершает биоформы и генетическую цепь; остаются native server,
сквозная интеграция и проверка всего ТЗ. Ledger сверять с исходниками.
Не выдавать dev-кандидат за полную или проверенную 1.17. Публичный TLS relay
не настроен: интернет-приглашения нельзя объявлять готовыми по локальному коду.

## История: проверенная alpha.5 (не текущий dev-кандидат)

Приёмка завершена: typecheck/build, точный полный npm test, Chrome E2E19/22/34–38 и независимая совместимость прошли. `final-verification.json` подтверждает неизменность всех 353 файлов freeze 3 и HTML; защищены 350 файлов alpha.4 и 339 файлов исправленной 1.16. E2E19 один раз не подтвердил два Canvas UI-предиката при параллельном прогоне; неизменённый отдельный повтор прошёл, причина первого сбоя не установлена. Не скрывать этот факт и не ослаблять проверки. Детали в CHECKS, не объявлять всю 1.17 готовой.

План: `docs/PLAN-1.17-alpha5.md`; итоговая приёмка: `docs/CHECKS-1.17-alpha5.md`; доказательства: `integration-logs/v117-alpha5-20261015/`. Не считать описания ниже подтверждением текущей приёмки без фактических кодов завершения.

Добавляются направления I–IV летуна: скорость +3%, разброс дроби −4%, энергопотребление оборудования −4%, лазерная защита −4%. Старые массивы, определяющие порядок предметов alpha.3, нельзя расширять так, чтобы сдвигать ID станции и санитарного робота: alpha.5 добавляется после всех 327 старых предметов. Формат сохранения остаётся 20. Скидка энергии относится к фактическим расходам `stepKit` и соответствующим порогам, без изменения генерации, ёмкости, силы щита/оружия и заводской сети. Личные строительные роботы в базовой игре не списывают заряд kit при возвращении; новую стоимость этот этап не вводит.

Перенесены исправления пересечений подземных труб, радиуса сигнальных проводов 30 клеток с предпросмотром и заправки локомотива (UI и манипуляторы при `no-fuel`). Основные приёмочные команды: точный `npm test`, `npm run typecheck`, `npm run build`, `npm run e2e -- 19 22 34 35 36 37 38` в Chrome (`PW_BROWSER=chromium`, `PW_EXECUTABLE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`). E2E38 проверяет производство всех четырёх направлений, настоящие эффекты, RU/EN, Canvas/main и WebGL/Worker, поздний вход с незавершённой партией и оборудованием инженера. Сохранение alpha.4 создано её исходным кодом во время рейса санитарного робота, затем проверяется новым кодом.

Теперь реализованы 12 из 36 направлений, 20 из 60 рецептов экстракции: ползуны, панцирник, летун. Остальные шесть семейств и другие разделы SPEC требуют следующих этапов. Полная 1.17, баланс всех 36 направлений, Firefox/Safari, отдельный Edge, 16 участников и 24-часовая приёмка ещё не закрыты. Старые доказательства alpha.4 остаются в её отдельном архиве; сюда перенесены обязательные тестовые fixtures и контрольный манифест базы.

## Сведения предыдущего этапа alpha.4

Продуктовое ТЗ: `docs/SPEC-1.17.md`; краткая сводка всех 12 разделов: `docs/ROADMAP-1.17-SHORT.md`. Это требования, а не подтверждение реализации. План этапа: `docs/PLAN-1.17-alpha4.md`, фактические результаты: `docs/CHECKS-1.17-alpha4.md`, сырые доказательства: `integration-logs/v117-alpha4-20261015/`. Инструкции в продуктовых документах не заменяют запрос пользователя.

### Завершённый этап alpha.4

Станция `bio-collection-station` типа `bioport`: 3×3, 120 кВт, радиус 24, максимум четыре робота суммарно в буфере и в работе. Рецепт: 20 стали, 10 продвинутых схем, 10 шестерёнок. `sanitary-robot`: летающая рама, две продвинутые схемы, два пластика. Технология `automated-bio-collection`: 150 RGB по 30 секунд, после биофракционирования и строительной робототехники.

Санитарный флот находится в `Game.bioRobots`, счётчик — `nextBioRobot`. Старые строительные/логистические роботы остаются в `Game.robots`. Фазы: idle, outbound, sampling, return, waiting-output. Батарея 1,5 МДж, скорость 2,4 клетки/с; четыре зарядных места по 30 кВт. Новый робот начинает без заряда, полный первый заряд занимает 50 игровых секунд. Питание подтверждается фактической долей электросети, заряженный робот продолжает полёт при отключении станции.

Режимы `corpses`, `all`, `film`; `bioFamily` — семейство или null. Команда `{t:'bioRobotConfig',id,mode?,family?}` меняет только переданные поля; Game.apply объединяет их с авторитетным состоянием и валидирует пару. UI отправляет только выбранное поле, иначе быстрый выбор второго select способен отменить первый через устаревший снимок. Пустые и неверные команды игнорируются; `family:null` снимает фильтр. Вход принимает пустые капсулы и роботов, выход — наполненные капсулы. Забор останков занимает 3 секунды, слизи — 2. Успешный сбор расходует пустую капсулу в наполненную, лишней пустой тары не появляется. Отмена возвращает пустую. На капсулу слизи требуется 64 единицы: из 230 получаются три капсулы и остаётся 38. `all` оставляет плёнку; `film` убирает остаток без капсулы и продукта.

Формат сохранения 20; v19 мигрирует с пустым санитарным флотом. Позиции, батареи, груз, задания и настройки входят в сохранения/хеши и снимки для Worker/кооператива. Первые 325 определений и индексов предметов альфы 3 сохранены, всего 327. Новых зависимостей нет. Для возврата к альфе 3/1.16 нужна копия старого мира.

Альфа 3 уже содержит направления I–IV ползунов и панцирника, извлечение с реальной кислотой, композиты, альтернативные покрытия патронов и одну активную биоподкладку. Не ослаблять эти проверки при дальнейших изменениях.

### Проверки alpha.4

Сначала прочитать итог CHECKS и реальные коды завершения. Команды: `npm run typecheck`, `npm run build`, точный `npm test`, `npm run e2e -- 34 35 36 37`. Chrome: `PW_EXECUTABLE_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`.

E2E37 использует настоящую паровую электросеть, два режима рендера/потока и RU/EN: физический заряд/полёт, фильтры, выдачу проб и очистку плёнки. Отдельно проверяется настоящий обмен Z7O/Z7A, поздний вход третьего участника во время работы робота и конкуренция ручного сбора за последнюю пробу. E2E34–36 сохраняют проверку прежних этапов.

Реализацию этапа выполнял один субагент gpt-6-luna/max, родитель независимо проверяет код, сохранения, браузер/кооператив и полный прогон. Не менять исходники и тесты во время финальных проверок. Не обновлять исторические эталонные хеши ради прохождения тестов. Архив игры запускается через `index.html`, исходники — через `npm ci` и `npm run build`.

### Историческая оценка остатка на alpha.4

Приёмка alpha.4 завершена: родитель наблюдал код 0 для typecheck, build, полного npm test и e2e34–37 в Chrome. `final-verification.json` подтверждает неизменность 350 файлов freeze 3, HTML и 347 файлов защищённой alpha.3. Исторические неудачные попытки сохранены отдельно. Новый баг пересечения подземных труб из 1.16 исправляется в отдельном кандидате и в эту замороженную alpha.4 пока не включён.

Семь остальных семейств биоматериалов, геномная библиотека и управляемые биороботы, шесть боевых дронов с портами, громкоговоритель, ближнее оружие, сервер одной кнопкой и остальные требования полного SPEC остаются следующими этапами. Финальный предел эффективности боя 8% и баланс всех 36 направлений ещё не приняты полным боевым стендом.

Firefox/Safari отложены пользователем. Отдельный Edge-прогон, сервер на 16 участников, 24 часа и полная нагрузочная приёмка 50 000 останков не закрыты. Эту альфу нельзя объявлять полной 1.17.

## Текущий этап после маршрутов (19 октября)

Локальный планировщик теперь рисует найденные обходы по габаритам всех
участников, считает loop/pingpong и время, ограничивает работу по кадрам.
Добавлены групповые позиции у точек, ответ только фактическому нападающему
в режиме без поиска боя, автоснабжение и UI связи/последнего контакта.
Это исходниковые изменения: `docs/RESUMED-20261019.md` и
`docs/PLAN-BIO-ROUTES-1.17-20261019.md`. Не переходить к тестам раньше
закрытия остальных функций. Same Luna/max завершил исходящий WSS relay
через общую авторизацию; сейчас делает настройки доступа/пароля/ролей и
pauseWhenEmpty. Реальный прямой WebRTC/P2P ещё отсутствует, публичный TLS
provider не задан. Эти пробелы нельзя переименовать в готовый интернет.

## Последний checkpoint: LAN/signatures, Luna quota

Luna/max исчерпал usage limit на исправлении access. Родитель подхватил:
Ed25519 вместо передачи admission seed, Node verify, LAN guard снят,
vendored TweetNaCl1.0.3 / noble-hashes2.0.1 с лицензиями/provenance, новый
одноразовый authworker и включение его в build.mjs. См. последний раздел
RESUMED-20261019.md и NATIVE-ACCESS-PLAN-1.17.md. Ни npm test, ни типы,
сборка, запуски или криптовекторы не выполнялись. Прямого native RTC ещё
нет; его план готов, прежде тестов нужно завершить транспорт и остаток ТЗ.
Не создавались новые агенты/модели, не изменялся shared node_modules.

## Latest checkpoint: native multipath source
Parent added real Node werift RTC + browser RTC, bounded shared sequence/ACK
and binary fragmentation, signed physical WS resume, same-session fallback,
stable relay routing and connection status. See RESUMED-20261019.md and
native/README.md. Earlier statements that RTC is absent are superseded by
source implementation, NOT by any acceptance evidence. No tests/types/builds
or game/server/browser execution occurred. Official public provider remains
external/unconfigured. Continue remaining SPEC functionality first (including
food cap accounting), then executable validation. No new agent/model was used.

## Latest checkpoint: nutrition source reservoirs
New feedings retain partial20-unit capsules at the player/post source, with
single tare return and internal20W/10minute cap. Saved partial-minute debit,
legacy partial drainage, source removal/death and RU/EN UI were updated.
See the final nutrition section in RESUMED-20261019.md. No executable checks
have run; continue functional source closure before tests.

## Latest checkpoint: public proposal, recovery, combat-drone lifecycle
User said to propose the domain. Proposed play.zavod7-game.net; no registration
or deployment, no claim of availability. Concrete private single-host HTTPS/WSS
files are in native/relay-public. Short-code landing/configured build origin
and password retry are wired in source. See RESUMED-20261019.md.
Parent also closed visible source gaps in drone inventory preflight, solo
repair/ownership, lost personal-source fallback, zero-energy landing,
non-resurrection of landed units, default auto-launch and inactive-module UI.
Ordinary reconnect now marks the replacement engineer active AFTER old detach;
failed auth storage releases provisional peers. Complete route loss stops held
input and bounded recovery resends the latest input. Large-save fallback uses
the actual2MiB logical transport cap. No checks have executed. Continue source
criteria reconciliation first; public infrastructure and multi-owner official
service remain outstanding and must not be described as deployed.

## Latest checkpoint: public provider source, not deployed
The parent added relay-gateway-service.ts with separate verified installation
keys/leases, bounded public enrolment and explicit private-token mode.
Host identity is private application data, never part of a transferable save
or installer payload. Guest admission/password/physical-resume proofs include
the expected server ID obtained from verified room metadata. Stable routing
accepts only admitted logical-session resumes. Public Compose/Caddy and real
optional Windows download are wired; proposed play.zavod7-game.net remains
unregistered/unconfigured/unverified. See native/relay-public/README.md.
WebSocket heartbeat already exists in the common transport; no duplicate timer
was added. This supersedes the former private-single-host-only next-work note.

## Latest checkpoint: chest configuration and robot reservations
Source work in PLAN-CHEST-TRANSFERS-1.17-20261019.md closes All-versus-numeric-S,
filter-safe insertion/sort/replacement, copied settings/blueprints/ghosts/undo,
closed input validation, and real-cell in-flight delivery reservations. Native
limits now permit warehouses beyond256 slots. Rejected arrivals retain cargo.
No tests, types, build, browser, server, installer or deployment have run.
Continue the remaining functional SPEC reconciliation before all testing;
do not label these paths accepted from source inspection alone. The single
Luna agent's quota blocker persists; these new edits are the parent's work.

Latest: personal auto-launch and preferred-model controls are now connected in source; see PLAN-DRONE-AUTOLAUNCH-1.17-20261019.md. Still no tests/types/build/runtime. Mechanical ownership transfer is now connected through UID/recipient commands, real inventory/source preflight and UI; see PLAN-DRONE-OWNERSHIP-1.17-20261019.md and RESUMED. Continue final functional coverage review before starting the unified checking phase. No whole-update acceptance claim.

19 Oct, latest bio-combat checkpoint: the SPEC 3.3 review found two real missing
functions: allied ranged acid/puddles and controlled destroyer detonation.
PLAN-BIO-COMBAT-1.17-20261019.md is now wired in source: stable owner on effects,
Swarm-only damage, legacy hostile paths preserved, closed save ingress, and
individual owner/link-validated arm/cancel commands with a saved 120-tick
countdown. The body stays still and cannot attack/change route/transfer while
arming; its blast consumes it once with W organic residue and no allied
genetic corpse. UI/countdown/radius, turquoise effects and bilingual reference
are connected. Normal bioform transfer now also requires a living body and
command contact (explicit admin rebind remains allowed). Existing full state
hash/snapshot/save paths carry the new optional fields. All executable
checks remain deferred; continue source coverage review, then unified tests.

Latest additional SPEC 6.1 source gap: forced-landed drones were freeing their deployment budget. PLAN-DRONE-GROUNDED-BUDGET-1.17-20261019.md now separates live-world budget reservations from flight checks across launch, return source and ownership admission. Grounded personal machines are visible/recoverable in module UI; target/repair cannot relaunch them. All executable checks still deferred. This supersedes the older assertion that flight-only budgets covered the full SPEC.

## Latest source checkpoint: mechanical repair targets
SPEC 6.2 explicitly excludes healing engineers/biology and requires repairing other mechanical drones. PLAN-DRONE-REPAIR-TARGETS-1.17-20261019.md is now wired: deterministic live structure/other-drone candidates, owner/faction/source-zone/LOS validation, actual-HP repair budget debit and one combined25 HP/s cap per target kind/UID. A closed optional command targetKind and saved repairTargetKind disambiguate IDs; old negative engineer targets are discarded. Unowned migrated friendly structures and offline owners remain eligible. Stationary combat drones with no threat and repair drones with no valid work return for maintenance.

No tests/typecheck/build/runtime have run. These source changes still need unified execution after functional coverage review. Do not repeat old ledger claims that engineers are an intended repair target, that landed drones free budgets, or that allied acid/destroyer preparation are missing: those paths have now been changed in source, not accepted at runtime. External public deployment remains unconfigured. No new agents/models launched.

## Verification phase started, 19 Oct
After wiring the final known SPEC mechanisms, parent moved from source reconciliation to executable checking. This supersedes earlier next-step instructions that prohibit starting checks. All release/operational acceptance is still pending.

Observed evidence: npm run build passed (dist/index.html 3605 KB) after removing a duplicated rail tail. A source diff of both 393-line copies showed only four older cargo/fuel differences in the second copy; the first copy preserves the 1.16 fix excluding locomotive fuel from wagon cargo/conditions. Comparison copies are under logs/verify-20261019/.

npm run typecheck initially reported209 errors, then passed after real @types/node replaced the conflicting tools/bot/node.d.ts globals, closed validator entries were typed, native RTC accessors/upgraded-socket boundaries were corrected, an omitted relay bound/interaction-distance helper was restored, and real item definitions were used in the reference. No compiler strictness was weakened. Shared node_modules was not changed.

Full npm test has been restarted after observed failures. Import-order failure was corrected by putting unchanged steam energy constants30/97 in an independent module; no physics coefficient changed. Alpha test expectations were updated only for current world format21 and biology scenario format3; old input migrations, append-only item IDs, resource/damage assertions and acceptance thresholds remain. The current full run is active (exec session39310), with complete output in logs/verify-20261019/npm-test.log. Do not mark it passed without its exit status. Build/types need final refresh after subsequent code fixes. No lint script is configured. Native/installer/browser/public network/performance acceptance remains unrun.

## Current verification checkpoint
New tests/v117-combat-contracts.test.ts passes real Game.step paths for owned acid impact/puddles, save/load ownership/hash, invalid ownership, individual destroyer arm/cancel/retry/120-tick fuse/save/loss, forced-landing admission and two repairers sharing25 HP/s while excluding engineer/biology. The suite is now part of npm test, with optional test:combat117 script. The fixture equips real armor/modules through kitCmd and grants their research/unlocks; engineer acid assertions compare an ordinary-regeneration control world.

Compatibility tests passed after their expected ledger explicitly included the required old80-to96-slot migration and exactly the first two inventory research credits. Every other research field/content remains compared; original save files and manifest are untouched. Current known existing IDs are preserved by the alias loader; only absent definitions are remapped. This corrected a real round-trip hash mismatch for the retained hidden melee-cleaver recipe.

Protected alpha5 evidence: original341 ID hash07a601ae4a48d033a33bdd2450a3158c58a8fd39f7037d751852daf4ace21aa0; full341 item metadata hash5f117f395254e481d8266adc282f9049ba0853e2494a2a3e0d6b8dd0c9f651a0; separate310-entry display-list hash3862aa08ca30e11b9f97136c7b01583c7b9fc17108e3931a232e6c0cf72d36e2. Current alpha5 tests pin these prefixes while permitting appended1.17 entries. Earlier327 goldens remain unchanged.

Build and typecheck passed again after the steam-cycle/alias changes and new tests. Full npm test is currently running in exec session44708; log is logs/verify-20261019/npm-test.log. Earlier session39310/48676 identifiers above are historical/closed. Do not claim whole-suite success without exit0. Native compiler exists at C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe; actual native packaging/installer operation is still unverified. No public deployment/registration or new subagents/models.
