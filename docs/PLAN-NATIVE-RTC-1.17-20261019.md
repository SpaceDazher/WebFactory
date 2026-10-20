# План прямого RTC для native-сервера — до исполнительных проверок

Фаза начинается после handoff/review настроек доступа того же Luna/max.
Требование §1.5: сервер работает без вкладки владельца, при доступном UDP
выбирает прямой WebRTC; при отказе пути продолжает через действующий WSS
relay. Это один PlayPeer/персонаж/авторитет, не новая игровая сессия.

## Основа и зависимости

ECC documentation-lookup прочитан; Context7 tools в текущей сессии нет,
поэтому просмотрены только первичные исходники/документация проекта:
- https://github.com/shinyoshiaki/werift-webrtc
- https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/develop/packages/webrtc/package.json
- https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/develop/examples/datachannel/offer.ts
- https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/develop/examples/datachannel/answer.ts
- https://github.com/shinyoshiaki/werift-webrtc/blob/develop/docs/browser-api-compatibility.md

Кандидат — werift: чистая реализация Node/JS, без скрытого Chromium и
нативного wrtc addon. Просмотренный develop package объявляет 0.25.1,
Node>=22 и MIT. Это не доказательство опубликованной версии или
совместимости всего runtime. Перед фиксацией нужна опубликованная
версия/lock/лицензии и соответствующий ей API, не плавающий develop.
Bundled Node проекта22.23.2; путь зависимостей/упаковки нужно согласовать
с esbuild ESM. Не устанавливать пакеты в shared junction node_modules,
не менять защищённые базы/архивы. Изолированная runtime dependency tree
и воспроизводимое включение в Windows/Docker обязательны.

## Контракт реализации

1. SDP/ICE только после общей auth-challenge/invite/password/admission-key
   проверки. Одно короткоживущее negotiation id на существующего peer;
   ограниченные SDP/candidates, таймаут и rate limit. Не принимать адреса
   для произвольного HTTP/TCP proxy; WSS gateway передаёт лишь сигналы.
2. Отдельный datachannel adapter к существующей NativeSocket/PlayPeer
   логике. На браузере обычный RTCPeerConnection, на сервере Node RTC.
   Не заводить второй Game, второй инвентарь или новый peer при upgrade.
3. Один ограниченный нумерованный поток поверх двух путей: cumulative ACK,
   bounded unacked/reorder window и bounded bytes, проверка safe-integer,
   подтверждение дублей и повтор не подтверждённых при смене пути. Старый
   link.ts без усиления не подходит: его окна/JSON не имеют нужных границ.
   Командный seq сам по себе не защищает снапшоты/RPC от перестановки.
4. Надёжный ordered DataChannel; ограниченные фрагменты (например16KiB),
   полная переcборка не выше native frame cap. Не отправлять 5/8MiB одним
   SCTP message. Сохранять существующие128MiB/384KiB snapshot aggregate
   и ACK-поведение; потери транспорта не подтверждают применённый снимок.
5. WSS остаётся служебным/запасным каналом. После ICE failed/disconnected
   bounded timeout, RTC error/backpressure или закрытия — немедленный
   fallback с тем же logical session. Публичная служба может пропасть:
   уже готовый прямой канал не должен закрываться только из-за WSS.
   При невосстановимом разрыве — обычный безопасный reconnect с world key.
6. Освобождать sockets/timers/ICE при stop, замене мира/поколения, revoke,
   reconnect и завершении peer; не печатать SDP, IP, invite/admission keys
   в общедоступный status/log. UI показывает прямой/relay/восстановление.
7. Операторские TLS/DNS/STUN/relay endpoints не выдумывать. Исходники
   транспорта не равны выполненному обещанию публичного сервиса.

## Граница приёмки

Никаких тестов/tsc/build/сервера/браузера пока остаются функциональные
пункты. После завершения функций: полный npm test и требуемые проверки,
затем Chrome/Edge + независимый native процесс, большой снимок, drop,
reorder/duplicates, reconnect/смена пути, потеря gateway при живом RTC,
NAT/CGNAT/blocked-UDP и16 игроков. Любое отсутствие доказательств отмечать
явно; не обещать готовый интернет по одной библиотеке или локальному WSS.
