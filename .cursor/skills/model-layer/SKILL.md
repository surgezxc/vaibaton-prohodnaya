---
name: model-layer
description: Изолированный слой модели с ДВУМЯ провайдерами (внешний + рабочий локальный), переключение из конфига. GigaChat можно как внешний, не обязателен. Use when wiring LLM, GigaChat, Ollama, prompts, or switching providers for defense.
---

# Слой модели: два провайдера

Допуск: модель реально вызывается; один изолированный слой; провайдер из конфига; **два** рабочих провайдера (внешний + локальный); инструкция как поднять локально; шаблоны промптов в репо. На защите переключают провайдера.

GigaChat **разрешён** как внешний. Не обязателен: внешним может быть любой HTTPS (GigaChat, OpenAI-compatible, то, что выдадут). Локальный должен **отвечать** без интернета (Ollama / llama.cpp / vLLM на localhost).

Не путать с кейсом документов: здесь модель нужна, OCR-пайплайн нет.

## Когда вызывать

- Любой `fetch` к LLM.
- «Пока только GigaChat, локальный потом».
- Смена провайдера на защите.
- Промпты размазаны по компонентам.

## Устройство

Один модуль, например `server/model/index.ts`. UI и помощник знают только:

```ts
export type ChatMsg = { role: "system" | "user"; content: string };

export type ModelProvider = {
  id: string;
  complete(msgs: ChatMsg[], opts?: { json?: boolean }): Promise<string>;
};

export function getModel(): ModelProvider; // читает config
```

Реализации в отдельных файлах: `providers/external.ts`, `providers/local.ts`. Не `if (gigachat)` в роуте помощника.

Конфиг (`.env`, не в git):

```
MODEL_PROVIDER=external   # или local
EXTERNAL_MODEL_BASE_URL=
EXTERNAL_MODEL_API_KEY=
EXTERNAL_MODEL_NAME=
LOCAL_MODEL_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_MODEL_NAME=qwen2.5:3b
```

`.env.example` с пустыми ключами. Смена на защите: одно значение `MODEL_PROVIDER` + рестарт (или горячий reload, если успеете). Показать судье файл и рабочий ответ с обоих.

GigaChat: адаптер в `external.ts` (их auth). Если ключа нет — внешний может быть любым OpenAI-compatible endpoint; в доке написать «подставить GigaChat так». **Не** делать GigaChat единственным классом в ядре.

## Локальный обязан работать

- Инструкция: [references/local-howto.md](references/local-howto.md) — скопировать в `docs/local-model.md` продукта.
- Модель маленькая (1–8B), CPU ok. Проверка: `curl` localhost возвращает текст.
- Нет локального ответа = не закрыт Д5–Д6. Заглушка `return "42 человека"` запрещена.

Нет ответа провайдера: статус `unavailable`, кнопка повтора, цифры из БД всё равно показать (см. `/grounded-assistant`).

## Промпты в репо

Файлы, не строка в JSX. Минимум:

- `prompts/assistant-formulate.md` — формулировка по фактам
- `prompts/intent-router.md` — опционально, если намерение через модель

Версии промптов упомянуть в отчёте об ИИ.

## Анти-паттерны

- Вызов GigaChat из React.
- Один провайдер.
- Ключ в git / в слайде.
- «Локальный» = мок-класс без модели.
- Менять провайдера правкой пяти файлов.

## Первое действие

Интерфейс `getModel()` + два провайдера + `MODEL_PROVIDER`. Прогон одного промпта на локальном (`curl`). Ключи только в `.env`.
