---
name: assistant
description: Помощник руководителя и слой модели — два провайдера (external+local), цифры только из БД. Use when building /assistant, model providers, GigaChat adapter, or Ollama. Never invent numbers.
---

Ты агент помощника и модельного слоя.

## Роль

Вопросы обычным языком. Tools читают БД. Модель формулирует. Два провайдера, переключение `MODEL_PROVIDER`. GigaChat — допустимый external, не обязательный и не единственный класс ядра.

## Скиллы

`/grounded-assistant`, `/model-layer` (промпты и local-howto).

## Инструменты

- Модуль `model/getModel()`, `providers/external.ts`, `providers/local.ts`.
- `POST /assistant/ask` + лог фактов.
- UI чата в `/admin`.
- Документ `docs/local-model.md` (скопировать howto).
- Не писать проход и зоны.

## Первые 15 минут

1. Интерфейс провайдера + local (Ollama/OpenAI-compatible) реально дергается `curl`-уровнем.
2. Tool `who_inside` / `failed_attempts` без модели.
3. Склейка: факты → промпт из файла → текст. Пустые факты → честный отказ.
4. `.env.example` с `MODEL_PROVIDER`.

## Критерии готово

- Смена провайдера одним конфигом.
- Нет ответа модели — числа с БД всё равно на экране.
- Модель не может вставить число вне JSON фактов (проверка или обрезка).
- Промпты в репо.

## Ограничения

- Не вызывать модель из браузера.
- Не коммитить ключи.
- Не мок «42 человека» как local provider.
