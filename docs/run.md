Телефон открывает `http://<LAN-IP>:8080/phone` в той же Wi-Fi. VPN выключен. Если этот адрес не открывается, файрвол блокирует Docker.

Камера и GPS на `http://<LAN-IP>:8080` не работают: браузер даёт их только в безопасном контексте. Страница, вход и экран сканера открываются. `https://<LAN-IP>:8443` остаётся. `<LAN-IP>` — это `LAN_IP` в `.env`, адрес ноутбука в Wi-Fi.

QR с ноутбука должен вести на тот же origin, что открыт на телефоне. Для телефона без сертификата откройте на ноутбуке `http://<LAN-IP>:8080/gate`.

# Запуск стенда

Команды для этого репозитория. Compose поднимает postgres, keycloak, api, face, web, HTTP `:8080` и HTTPS `:8443`. Телефон в той же Wi-Fi открывает `http://<LAN-IP>:8080`. Ноутбук по-прежнему может открыть `https://<LAN-IP>:8443` и `http://localhost:43123`.

## С нуля

```bash
git clone git@github.com:surgezxc/vaibaton-prohodnaya.git
cd vaibaton-prohodnaya
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

В `.env` впишите `LAN_IP` — IPv4 ноутбука в Wi-Fi, без `https://` и без порта. Linux: `hostname -I | awk '{print $1}'`. macOS: `ipconfig getifaddr en0`.

```bash
docker compose up --build
```

Когда образы уже собраны и скачаны, повторный запуск без сети:

```bash
docker compose up
```

Пароли только в `.env`, в git их не кладут. Заполните `POSTGRES_PASSWORD` и `KEYCLOAK_ADMIN_PASSWORD`. Если переменная пустая, compose берёт `change-me`. Админ Keycloak — `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`, по умолчанию `admin` / `change-me`.

Порты из `docker-compose.yml`:

| Сервис | Куда открывать |
| --- | --- |
| Postgres | `localhost:5432`, база `prohodnaya`, пользователь `prohodnaya` |
| Keycloak | `http://localhost:8081`, realm `prohodnaya` |
| API | `http://localhost:3001` |
| Телефон | `http://<LAN-IP>:8080/phone` — тот же Wi-Fi, без сертификата. Вход и экран сканера на этом origin. Камера и GPS здесь не работают |
| Ноутбук по HTTPS | `https://<LAN-IP>:8443` — `/gate`, `/admin`. Путь не убран |
| Сертификат ЦС | `http://<LAN-IP>:8088/ca.crt` — только если нужен `https://<LAN-IP>:8443` |
| Web внутри сети Docker | `web:43123`, с хоста `http://localhost:43123` для отладки, не для телефона |
| Face | порт на хост не публикуется; API ходит на `http://face:8000` |

Keycloak в compose слушает HTTP `8081` на хосте для localhost. Браузер телефона ходит в него через `http://<LAN-IP>:8080` (страница, `/realms`, `/resources` и API на одном origin). Ноутбук по HTTPS ходит через `https://<LAN-IP>:8443`. Issuer в токене совпадает с адресом, который открыл браузер. API принимает оба адреса и `http://localhost:8081`.

Порог сравнения лиц в `docker-compose.yml`: `FACE_MATCH_THRESHOLD=0.69`. Ниже 0.69 не опускать. Рядом: `FACE_DETECT_CONFIDENCE=0.25`, `FACE_LIVENESS_THRESHOLD=0.8`.

Проверка, что контейнеры живы:

```bash
docker compose ps
docker compose exec postgres pg_isready -U prohodnaya -d prohodnaya
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8081/realms/prohodnaya
```

Миграции API применяет сам при старте. Отдельно, если API запущен с хоста, а не из compose:

```bash
cd apps/api
npm install
npm test
npm run dev
```

`npm test` ждёт Postgres на `postgres://prohodnaya:prohodnaya@127.0.0.1:5432/prohodnaya_test`. Для стенда в `.env` оставьте пароль из compose.

Браузер `apps/web` ходит в API по `NEXT_PUBLIC_API_URL`. В compose по умолчанию это `http://localhost:3001`. Прокси `/api/proxy` есть в прежней копии `alison/apps/web`, стенд его не использует.

## Учётки

Realm импортируется из `infra/keycloak/prohodnaya-realm.json`. В импортируемом realm для демонстрационных учётных записей задан пароль `dev-only`. Перед публичным показом замените его. В репозиторий новый пароль не коммитят. Администратор самого Keycloak использует `KEYCLOAK_ADMIN` и `KEYCLOAK_ADMIN_PASSWORD` из `.env`.

| Логин | Роль | Куда |
| --- | --- | --- |
| `admin` | `admin` | `/admin` — заведение и эталон; `/admin/zones` — план, три точки привязки, границы зон |
| `manager` | `manager` | `/manager` — кто внутри, теплокарта, маршруты, отчёт, помощник |
| `gate` | `gate` | `/gate` — открывает QR |
| `worker` | `worker` | `/phone` — один раз регистрирует открытый ключ устройства и сканирует QR |
| `worker2` | `worker` | второй телефон, чтобы проверить «чужое устройство» |

Направление QR: код показывает `/gate`, сканирует `/phone`. Скопированный JWT без ключа телефона — отказ «чужое устройство». Passkey нет. Регистрация ключа оставлена экрану `/phone`.

Экраны телефона: `http://<LAN-IP>:8080/phone` (учётка `worker`). Экраны ноутбука на том же HTTP, если QR должен открыться на телефоне: `/gate` (`gate`). `https://<LAN-IP>:8443` по-прежнему отдаёт `/gate`, `/phone`, `/admin` (`admin`), `/admin/zones`, `/manager` (`manager`). В `/admin` нажмите «Подставить учётку worker», приложите фото и «Завести и записать эталон». Без compose: `cd apps/web && npm ci && npm run dev`.

Клиент браузера в realm — `web` (public). Секрет клиента `api` в realm — заглушка `dev-only-change-me`, не боевой ключ.

Маршрут `/admin/zones` в `apps/web` есть: план, три точки и полигоны. Вкладка «Зоны и схема» на странице `/admin` — экран прежней копии `alison/apps/web`, не маршрут стенда.

## Телефон по HTTP

Порт `0.0.0.0:8080` отдаёт ту же страницу, что и HTTPS, и проксирует API и Keycloak на этот origin. Сертификат для этого адреса не нужен.

1. Телефон и ноутбук в одной Wi-Fi. VPN выключен.
2. Откройте `http://<LAN-IP>:8080/phone`. Если адрес не грузится, файрвол блокирует Docker.
3. Войдите учёткой `worker`. Экран сканера QR отрисуется. Кнопка камеры на HTTP сообщит, что камера недоступна. Ключ телефона и GPS тоже недоступны без HTTPS.
4. Чтобы ссылка в QR совпала с телефоном, QR открывайте с `http://<LAN-IP>:8080/gate`.

Сервис `keycloak-redirects` должен завершиться с кодом 0, иначе вход с `http://<LAN-IP>:8080` не вернётся в приложение. После обновления этого репозитория на уже запущенном стенде: `docker compose up --build`. Compose пересоздаст Keycloak, API и прокси из-за новых переменных.

## Сертификат на Android

Прокси `https` в compose по-прежнему выпускает локальный ЦС Caddy (`tls internal`) и отдаёт страницу, API и Keycloak с `https://<LAN-IP>:8443`. Этот путь не заменяет HTTP выше. Файл ЦС не секрет репозитория: он появляется в томе `caddy_data` при старте. На `https://<LAN-IP>:8443` камера и GPS браузеру доступны.

1. На телефоне в той же Wi-Fi откройте `http://<LAN-IP>:8088/ca.crt`.
2. Установите его как сертификат ЦС: Настройки → Безопасность → Установка сертификатов → Сертификат ЦС. Если Android спросит блокировку экрана, задайте её.
3. Откройте `https://<LAN-IP>:8443/phone`. Ноутбук открывает `https://<LAN-IP>:8443/gate`. QR с этого адреса ведёт на тот же HTTPS-origin.

Если браузер ноутбука не доверяет адресу, установите тот же `http://<LAN-IP>:8088/ca.crt`. Новый том `caddy_data` выпускает новый ЦС, тогда файл ставят заново.

## Остановка

```bash
docker compose down
```

Данные Postgres лежат в томе `pgdata`. Команда сохраняет данные в томе. Не добавляйте `-v`, если нужно оставить базу между запусками.

## Что не подтверждено

10 октября 2026 года проверка, приложенная к черновикам в корне, увидела успешный `docker compose config --quiet`. Полный `docker compose up --build` и браузерные сценарии в той среде не состоялись: демон Docker не ответил, доверенный сертификат не выпускался. Добавление плана, трёх точек, полигона и сохранение после обновления не проверены. Фильтры, теплокарта, маршруты и помощник на `/manager` там тоже не проверены. Живой ключ GigaChat и HTTPS с реального телефона не подтверждены. Это статус той проверки, не замена портов и сервисов compose и не инструкция под одну операционную систему.
