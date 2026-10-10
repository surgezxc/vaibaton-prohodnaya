Телефон открывает `https://<LAN-IP>:8443/phone` после установки локального ЦС.

Один шаг на Android: откройте `http://<LAN-IP>:8088/ca.crt` и установите файл как сертификат ЦС (Настройки → Безопасность → Установка сертификатов → Сертификат ЦС). Затем откройте `https://<LAN-IP>:8443/phone`.

Ноутбук открывает тот же адрес: `https://<LAN-IP>:8443/gate`. `<LAN-IP>` — это `LAN_IP` в `.env`, адрес ноутбука в Wi-Fi.

# Запуск стенда

Команды для этого репозитория. Compose поднимает postgres, keycloak, api, face, web и HTTPS-прокси. Ноутбук и телефон в одной Wi-Fi открывают один origin `https://<LAN-IP>:8443`. Камера и геолокация работают на этом адресе.

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
| Телефон и ноутбук | `https://<LAN-IP>:8443` — один origin. Телефон: `/phone`. Ноутбук: `/gate`, `/admin` |
| Сертификат ЦС | `http://<LAN-IP>:8088/ca.crt` |
| Web внутри сети Docker | `web:43123`, с хоста `http://localhost:43123` для отладки, не для телефона |
| Face | порт на хост не публикуется; API ходит на `http://face:8000` |

Keycloak в compose слушает HTTP `8081` только внутри стенда. Браузер ходит в него через `https://<LAN-IP>:8443`. Issuer токена — `https://<LAN-IP>:8443/realms/prohodnaya`.

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

Экраны на общем адресе `https://<LAN-IP>:8443`: `/gate` (учётка `gate`), `/phone` (`worker`), `/admin` (`admin`), `/admin/zones`, `/manager` (`manager`). В `/admin` нажмите «Подставить учётку worker», приложите фото и «Завести и записать эталон». Без compose: `cd apps/web && npm ci && npm run dev`.

Клиент браузера в realm — `web` (public). Секрет клиента `api` в realm — заглушка `dev-only-change-me`, не боевой ключ.

Маршрут `/admin/zones` в `apps/web` есть: план, три точки и полигоны. Вкладка «Зоны и схема» на странице `/admin` — экран прежней копии `alison/apps/web`, не маршрут стенда.

## Сертификат на Android

Прокси `https` в compose выпускает локальный ЦС Caddy (`tls internal`) и отдаёт страницу, API и Keycloak с одного адреса `https://<LAN-IP>:8443`. Файл ЦС не секрет репозитория: он появляется в томе `caddy_data` при старте.

1. На телефоне в той же Wi-Fi откройте `http://<LAN-IP>:8088/ca.crt`.
2. Установите его как сертификат ЦС: Настройки → Безопасность → Установка сертификатов → Сертификат ЦС. Если Android спросит блокировку экрана, задайте её.
3. Откройте `https://<LAN-IP>:8443/phone`. Ноутбук открывает `https://<LAN-IP>:8443/gate`. QR с ноутбука ведёт на тот же origin.

Если браузер ноутбука не доверяет адресу, установите тот же `http://<LAN-IP>:8088/ca.crt`. Новый том `caddy_data` выпускает новый ЦС, тогда файл ставят заново. Сервис `keycloak-redirects` должен завершиться с кодом 0, иначе вход с этого адреса не вернётся в приложение.

## Остановка

```bash
docker compose down
```

Данные Postgres лежат в томе `pgdata`. Команда сохраняет данные в томе. Не добавляйте `-v`, если нужно оставить базу между запусками.

## Что не подтверждено

10 октября 2026 года проверка, приложенная к черновикам в корне, увидела успешный `docker compose config --quiet`. Полный `docker compose up --build` и браузерные сценарии в той среде не состоялись: демон Docker не ответил, доверенный сертификат не выпускался. Добавление плана, трёх точек, полигона и сохранение после обновления не проверены. Фильтры, теплокарта, маршруты и помощник на `/manager` там тоже не проверены. Живой ключ GigaChat и HTTPS с реального телефона не подтверждены. Это статус той проверки, не замена портов и сервисов compose и не инструкция под одну операционную систему.
