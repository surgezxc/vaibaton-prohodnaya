# Как поднять локальную модель

Для копирования в `docs/local-model.md`.

## Вариант A — Ollama (быстрее на ноуте)

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:3b
ollama serve   # http://127.0.0.1:11434
```

Проверка:

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:3b","messages":[{"role":"user","content":"Ответь: ок"}]}'
```

В `.env`:

```
MODEL_PROVIDER=local
LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_MODEL_NAME=qwen2.5:3b
```

## Вариант B — нет прав на установку

Собрать заранее бинарник llama.cpp + GGUF (маленький) и слушать OpenAI-совместимый порт. Команды запуска — в том же `docs/local-model.md`.

## Защита

1. Показать ответ помощника на `external`.
2. Сменить `MODEL_PROVIDER=local`, перезапуск.
3. Тот же вопрос — ответ пришёл, цифры те же (из БД).
