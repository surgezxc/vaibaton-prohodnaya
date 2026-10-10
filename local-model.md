# Переход на локальную модель

Текстовый слой один. Переключатель — `MODEL_PROVIDER=gigachat|ollama`. Локально работает Ollama, модель `qwen3:4b`. Лицо (YOLO, InsightFace) этим переключателем не меняется.

В `docker-compose.yml` у api уже стоит `OLLAMA_MODEL` по умолчанию `qwen3:4b` и `OLLAMA_BASE_URL=http://host.docker.internal:11434`. В `apps/api/.env.example` для запуска api с хоста — `http://127.0.0.1:11434`.

## Поднять Ollama

Команда Docker, не установка пакета в ОС:

```bash
docker run -d --name ollama -p 11434:11434 -v ollama:/root/.ollama ollama/ollama
docker exec ollama ollama pull qwen3:4b
```

Проверка, что модель отвечает:

```bash
curl -s http://127.0.0.1:11434/api/chat \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3:4b","messages":[{"role":"user","content":"Ответь одним словом: да"}],"stream":false}'
```

## Включить на стенде

В `.env` рядом с compose и в `apps/api/.env`:

```bash
MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3:4b
```

Если api запущен через `npm run dev` на той же машине, что и контейнер Ollama, в `apps/api/.env` адрес `http://127.0.0.1:11434`.

Перезапуск только api:

```bash
docker compose up -d --build api
```

На защите тот же вопрос помощнику задают ещё раз. Цифры в ответе не должны измениться: их считает SQL, сервер подставляет по имени поля (`people`, `shifts`, `deviations`, `refusals`, `anomalies`).

## Вернуться на GigaChat

```bash
MODEL_PROVIDER=gigachat
GIGACHAT_API_KEY=ключ-не-в-git
```

Ключ только в `.env`. После смены снова `docker compose up -d --build api`. Тот же вопрос, те же числа из базы. Если GigaChat молчит, API пишет статус и не подставляет выдуманные цифры.

`MODEL_PROVIDER` принимает только `gigachat` и `ollama`.

## Проверка в этой среде

10 октября 2026 года запуск Ollama и запрос к модели не выполнялись: Docker daemon недоступен, а `docker` в инструкции запуска Ollama не может подключиться к Docker API. Поэтому ответ модели, время ответа и работа помощника с `qwen3:4b` здесь не подтверждены. Проверка `docker compose config --quiet` подтвердила только синтаксис Compose, но не доступность Ollama или API.
