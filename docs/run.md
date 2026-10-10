# Запуск стенда

Команды для этого репозитория. Поднимаются postgres, keycloak, api, face и web.

## С нуля

```bash
git clone git@github.com:surgezxc/vaibaton-prohodnaya.git
cd vaibaton-prohodnaya
cp apps/api/.env.example apps/api/.env
docker compose up --build
```

Пароль Postgres в compose — `POSTGRES_PASSWORD`, если переменная пустая, берётся `change-me`. Админ Keycloak — `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`, по умолчанию `admin` / `change-me`. Секреты в git не кладём.

Порты из `docker-compose.yml`:

| Сервис | Куда открывать |
| --- | --- |
| Postgres | `localhost:5432`, база `prohodnaya`, пользователь `prohodnaya` |
| Keycloak | `http://localhost:8081`, realm `prohodnaya` |
| API | `http://localhost:3001` |
| Web | `http://localhost:43123` |

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

## Учётки

Realm импортируется из `infra/keycloak/prohodnaya-realm.json`. Пароль этих учёток на стенде — `dev-only`. Перед публичным показом его меняют, в репозиторий новый пароль не коммитят.

| Логин | Роль | Куда |
| --- | --- | --- |
| `admin` | `admin` | `/admin` — заведение, эталон; `/admin/zones` — план, точки привязки, границы зон |
| `manager` | `manager` | `/manager` — кто внутри, теплокарта, маршруты, отчёт, помощник |
| `gate` | `gate` | `/gate` — открывает QR |
| `worker` | `worker` | `/phone` — сканирует QR |
| `worker2` | `worker` | второй телефон, чтобы проверить «чужое устройство» |

Экраны в `apps/web`. Стенд: `http://localhost:43123/gate` (учётка `gate`), `/phone` (`worker`), `/admin` (`admin`), `/manager` (`manager`). Без compose: `cd apps/web && npm ci && npm run dev`.

Клиент браузера в realm — `web` (public). Секрет клиента `api` в realm — заглушка `dev-only-change-me`, не боевой ключ.

## HTTPS обязателен

Камера и геолокация в браузере работают только в защищённом контексте. Адрес `http://` в локальной сети им не подходит, даже если API с телефона открывается. Исключение браузера — `http://localhost` на той же машине. Планшету и телефону этого мало.

Compose отдаёт postgres, keycloak, api, face и web по HTTP на портах выше. Face наружу порт не публикует: API ходит на `http://face:8000`. Перед показом origin браузера закрывают TLS. Пример на Docker, без установки пакетов в ОС (сертификат внутренний, браузер один раз предупредит):

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

Для камеры на планшете и телефоне в `reverse_proxy` ставят порт web (`43123`), не API. Правило то же: страница, с которой вызывают камеру, открыта по HTTPS.

Остановка:

```bash
docker compose down
```

Данные Postgres лежат в томе `pgdata`. `docker compose down` том не удаляет.
