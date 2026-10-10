# Запуск стенда

Инструкция поднимает сервисы через Docker Compose. Камера и геолокация в браузере требуют защищённого контекста; для доступа по локальной сети используйте HTTPS и сертификат, которому доверяет устройство.

## Требования

- Docker Desktop или Docker Engine с Docker Compose v2.
- `mkcert` для локального HTTPS-сертификата.
- Свободные порты 3000, 3001, 5432, 8000, 8081, 8443 и 9000. Порты можно изменить в `.env`.

## Подготовка

Скопируйте пример настроек и задайте два локальных пароля:

```bash
cp .env.example .env
```

Заполните `POSTGRES_PASSWORD` и `KEYCLOAK_ADMIN_PASSWORD` в `.env`. Эти значения не добавляйте в Git.

Для открытия стенда только на этом компьютере выпустите сертификат для `localhost`. Чтобы подключать телефон, укажите LAN-IP компьютера вместо `192.168.1.25` в команде и установите корневой сертификат на телефон:

```bash
mkcert -install
mkdir -p certs
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem localhost 127.0.0.1 ::1 192.168.1.25
cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem
```

Каталог `certs/` исключён из Git. Установите `rootCA.pem` на телефон и отметьте сертификат доверенным, чтобы браузер телефона принимал HTTPS-соединение.

## Запуск

Из корня репозитория выполните:

```bash
docker compose up --build -d
docker compose ps
```

Пользовательский клиент Keycloak в realm называется `web`. В настройках клиента должны быть разрешены redirect URI и web origin для адреса стенда: для этого компьютера `https://localhost:3000/*`, для доступа с телефона — `https://192.168.1.25:3000/*` (замените IP на свой). Для доступа с телефона задайте в `.env` `WEB_ORIGIN=https://<адрес>:3000`, `NEXT_PUBLIC_KEYCLOAK_URL=https://<адрес>:8443` и `KEYCLOAK_ISSUER=https://<адрес>:8443/realms/prohodnaya`. Эти адреса должны совпадать с именами в сертификате.

Откройте нужный экран:

| Экран | URL на этом компьютере | Роль |
| --- | --- | --- |
| Администрирование | `https://localhost:3000/admin` | `admin` |
| Руководитель | `https://localhost:3000/manager` | `manager` |
| Контролёр | `https://localhost:3000/gate` | `gate` |
| Рабочий | `https://localhost:3000/phone` | `worker` |
| Keycloak | `https://localhost:8443` | локальный администратор из `.env` |

В импортируемом realm для демонстрационных учётных записей задан пароль `dev-only`. Перед публичным показом замените его. Администратор самого Keycloak использует `KEYCLOAK_ADMIN` и `KEYCLOAK_ADMIN_PASSWORD` из `.env`.

## Ограничения этого стенда

Compose подключает API из `apps/api` и face service из `deliverables/a-shorokhov-face-model/services/face`. Сквозной запуск и распознавание в этой сессии не проверялись. Доступность экранов и сохранение плана зависят от корректно запущенных сервисов и данных API.

API доступен на `http://localhost:3001`, Postgres — на `localhost:5432`. Веб-клиент обращается к API через серверный прокси `web`, а не напрямую из браузера.

## Остановка

```bash
docker compose down
```

Команда сохраняет данные в томе `pgdata`. Не добавляйте `-v`, если нужно оставить базу между запусками.
