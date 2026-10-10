# Проходная: экраны

Next.js, TypeScript, Tailwind. Четыре маршрута ходят в уже существующий API и в Keycloak (realm `prohodnaya`, клиент `web`, password grant).

| Маршрут | Учётка стенда | Что делает |
| --- | --- | --- |
| `/gate` | `gate` | вход/выход, QR попытки, кадр КПП, `POST /attempts/:id/decide` |
| `/phone` | `worker` | ключ ECDSA P-256 в этом браузере, скан QR, симуляция зоны |
| `/admin` | `admin` | карточка и эталон, список, журнал |
| `/manager` | `manager` | кто внутри и с какого времени |

Пароль учёток стенда — `dev-only`. Адреса по умолчанию: API `http://localhost:3001`, Keycloak `http://localhost:8081`. Переопределение на сборке: `NEXT_PUBLIC_API_URL` и `NEXT_PUBLIC_KEYCLOAK_URL`.

```bash
cd apps/web
npm ci
npm run dev
```

Сайт открывается на `http://localhost:43123`. В compose тот же порт. Камера на телефоне в локальной сети требует HTTPS; на `localhost` браузер пускает её и по HTTP.
