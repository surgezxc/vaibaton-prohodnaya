# Агенты «Проходная»

Набор для вайбкодинга кейса контроля прохода на стройке. Продукта в репо нет. Документы соискателей сняты.

В чате Cursor: `/имя`. Скиллы — тоже `/имя`.

## Кого звать

| Когда | Агент | Первый ход |
| --- | --- | --- |
| Планшет проходной | `/gate` | `/gate`: люди, вход/выход, камера |
| Телефон рабочего | `/worker-phone` | credential на устройстве, не статичный QR |
| Сервер прохода, журнал, смены | `/backend-pass` | `POST /attempts` + `decide` в транзакции |
| Завести человека, эталон, журнал UI | `/enroll-admin` | форма + отбраковка 0 / ≥2 лиц |
| Кто внутри, зоны, тепло | `/analytics` | список открытых смен + полигон в БД |
| Помощник и провайдеры модели | `/assistant` | `getModel()` + tool над БД |
| Доки, коммиты, Д9/Д10 | `/docs-defense` | `docs/*` + `.env.example` |

Старт: `/docs-defense` (bootstrap) → `/backend-pass` ∥ `/gate` ∥ `/worker-phone` ∥ `/enroll-admin`. Когда события пишутся — `/analytics` и `/assistant`.

## Скиллы

`/hackathon-vibe` `/gate-pass-security` `/face-enroll-match` `/phone-proof` `/shift-zones` `/grounded-assistant` `/model-layer` `/role-uis` `/git-docs-defense` `/hackathon-pitch`

## Инварианты

- Сервер решает проход. Нельзя пройти за другого.
- Лицо 1:1 с эталоном, не детектор.
- Два провайдера модели; GigaChat необязателен.
- Три браузерных UI. Русский копирайт. Без секретов в git.
