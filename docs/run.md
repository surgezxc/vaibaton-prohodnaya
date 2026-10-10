# Запуск стенда

Команды для этого репозитория. Compose поднимает postgres, keycloak, api, face и web. Камера и геолокация в браузере требуют защищённого контекста. Для телефона и планшета в локальной сети нужен HTTPS. Исключение браузера — `http://localhost` на той же машине.

## С нуля

```bash
git clone git@github.com:surgezxc/vaibaton-prohodnaya.git
cd vaibaton-prohodnaya
cp .env.example .env
cp apps/api/.env.example apps/api/.env
docker compose up --build
```

Пароли только в `.env`, в git их не кладут. Заполните `POSTGRES_PASSWORD` и `KEYCLOAK_ADMIN_PASSWORD`. Если переменная пустая, compose берёт `change-me`. Админ Keycloak — `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`, по умолчанию `admin` / `change-me`.

Порты из `docker-compose.yml`:

| Сервис | Куда открывать |
| --- | --- |
| Postgres | `localhost:5432`, база `prohodnaya`, пользователь `prohodnaya` |
| Keycloak | `http://localhost:8081`, realm `prohodnaya` |
| API | `http://localhost:3001` |
| Web | `http://localhost:43123` |
| Face | порт на хост не публикуется; API ходит на `http://face:8000` |

Сервисы compose — эти пять. Хостовых портов 3000 и 9000 в файле нет. Keycloak в compose слушает HTTP `8081`, не HTTPS `8443`.

Порог сравнения лиц. README сервиса `deliverables/a-shorokhov-face-model/services/face/README.md` и значение по умолчанию в `face.py` — **0.69** (на пакете кадров 41/52 своих и 0/468 чужих; прежний порог 0.74 давал 31/52 своих). В `docker-compose.yml` переменная `FACE_MATCH_THRESHOLD` сейчас равна `"0.74"`. Пока строка compose не совпадёт с README, контейнер сравнивает с 0.74. Рядом в том же сервисе: `FACE_DETECT_CONFIDENCE=0.25`, `FACE_LIVENESS_THRESHOLD=0.8`.

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

Экраны в `apps/web`. Стенд на этой машине: `http://localhost:43123/gate` (учётка `gate`), `/phone` (`worker`), `/admin` (`admin`), `/admin/zones`, `/manager` (`manager`). Без compose: `cd apps/web && npm ci && npm run dev`.

Клиент браузера в realm — `web` (public). Секрет клиента `api` в realm — заглушка `dev-only-change-me`, не боевой ключ.

Маршрут `/admin/zones` в `apps/web` есть: план, три точки и полигоны. Вкладка «Зоны и схема» на странице `/admin` — экран прежней копии `alison/apps/web`, не маршрут стенда.

## HTTPS

Камера и геолокация работают только в защищённом контексте. Адрес `http://` в локальной сети им не подходит, даже если API с телефона открывается. `http://localhost` годится только на той же машине, где открыт браузер.

Compose отдаёт postgres, keycloak, api, face и web по HTTP на портах выше. Перед показом с планшета или телефона origin браузера закрывают TLS. Пример на Docker, без установки пакетов в операционную систему. Сертификат внутренний, браузер один раз предупредит:

```bash
mkdir -p /tmp/prohodnaya-caddy
cat > /tmp/prohodnaya-caddy/Caddyfile <<'EOF'
:443 {
	tls internal
	reverse_proxy host.docker.internal:43123
}
EOF
docker run --rm --name prohodnaya-https -p 8443:443 \
  -v /tmp/prohodnaya-caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v prohodnaya-caddy-data:/data \
  caddy:2-alpine
```

Для камеры на планшете и телефоне в `reverse_proxy` стоит порт web (`43123`), не API. Страница, с которой вызывают камеру, должна быть открыта по HTTPS. Файлы `*.pem` в git не попадают.

Живой заход с телефона по HTTPS не подтверждён. Compose держит `KEYCLOAK_ISSUER` равным `http://localhost:8081/realms/prohodnaya`, а образ web собирается с `NEXT_PUBLIC_KEYCLOAK_URL` по умолчанию `http://localhost:8081`. С телефона `localhost` — это сам телефон. Пока issuer и адрес Keycloak не совпадут с именем, которое видит устройство, вход с телефона не обещаем.

## Остановка

```bash
docker compose down
```

Данные Postgres лежат в томе `pgdata`. Команда сохраняет данные в томе. Не добавляйте `-v`, если нужно оставить базу между запусками.

## Что не подтверждено

10 октября 2026 года проверка, приложенная к черновикам в корне, увидела успешный `docker compose config --quiet`. Полный `docker compose up --build` и браузерные сценарии в той среде не состоялись: демон Docker не ответил, доверенный сертификат не выпускался. Добавление плана, трёх точек, полигона и сохранение после обновления не проверены. Фильтры, теплокарта, маршруты и помощник на `/manager` там тоже не проверены. Живой ключ GigaChat и HTTPS с реального телефона не подтверждены. Это статус той проверки, не замена портов и сервисов compose и не инструкция под одну операционную систему.
