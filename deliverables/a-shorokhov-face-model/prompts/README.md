# Модельный слой — часть a-shorokhov

В этой папке сохранена реализация `apps/api/src/model`; контракт `getModel().complete(messages)`
сохранён. HTTP-маршруты, SQL tools, права и журналы в `modules/assistant.ts` не менялись.
`assistant-formulate.md` и `response-format.md` описывают проверяемую формулировку.

## Запуск и проверка для алисона

Нужен Node >=22. Из `apps/api`:

```sh
npm ci
npm run build
node --import tsx --test test/model.test.ts
MODEL_PROVIDER=ollama node --import tsx src/model/smoke.ts
```

`smoke.ts` использует явно отмеченную SQL-форму фикстуры, не живые данные
предприятия. Пример проверяет различие 12 людей, 14 смен и 0 отказов.
В приложении эти значения приходят из существующих SQL tools.

На Mac установить [Ollama](https://ollama.com/download/mac), в отдельном терминале:

```sh
ollama serve
```

Затем `ollama pull qwen3:4b`. После скачивания нет зависимости от внешнего LLM.
В исходной рабочей копии на этом Mac CLI скачан внутри игнорируемого `.runtime/Ollama.app`, веса
лежат в `.runtime/models`. Бинарники в эту поставку не входят. Для исходной копии команда из корня репозитория:

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$PWD/prompts/.runtime/models" OLLAMA_NO_CLOUD=1 prompts/.runtime/Ollama.app/Contents/Resources/ollama serve
```

Проверен реальный `qwen3:4b` через модуль API: корректная формулировка за 3.4 s
на M4 Pro/24 GB. Первый холодный запуск может быть медленнее; local timeout по
умолчанию 60000 ms, внешний 8000 ms. Один повтор разрешён только для неверного
формата; HTTP-ошибка/таймаут возвращаются в существующий `unavailable/retry=true`.

Для переключения использовать локальную `.env` и перезапуск API:

```dotenv
MODEL_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
MODEL_TIMEOUT_MS=60000
PROMPTS_PATH=/absolute/path/to/prompts/assistant-formulate.md
GIGACHAT_API_KEY=
GIGACHAT_BASE_URL=https://api.giga.chat/v1
GIGACHAT_AUTH_URL=https://ngw.devices.sberbank.ru:9443/api/v2/oauth
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_MODEL=GigaChat
```

Значение `GIGACHAT_API_KEY` — ключ авторизации Basic, не access token; заполняется
только локально. Затем `MODEL_PROVIDER=gigachat node --env-file=../../.env --import tsx src/model/smoke.ts`.
OAuth и ответы проверены тестами, но реальный запрос GigaChat не выполнен: ключа
в рабочей копии нет. TLS не отключается; если нужны сертификаты, настроить
доверенные сертификаты Node через `NODE_EXTRA_CA_CERTS`, не `rejectUnauthorized=false`.
Актуальный адрес для новых подключений:
[документация GigaChat](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api).

При использовании готовой локальной .env API env-file должен быть загружен
при старте процесса, например `node --env-file=../../.env dist/index.js`.
В Docker API адрес Ollama на Mac — `http://host.docker.internal:11434`; Ollama
должен слушать интерфейс, доступный Docker. Порт модели не открывать в интернете.

В Compose алисон монтирует `./prompts:/app/prompts:ro` и задаёт
`PROMPTS_PATH=/app/prompts/assistant-formulate.md`; иначе текущий Dockerfile API
не включает эти файлы и помощник честно возвращает недоступность формулировки.
Добавить имена env в общую `.env.example`, секретное значение оставить пустым.

## Границы приёмки

Нет строк — «Данных нет.» без вызова LLM. Нулевые агрегаты с существующей строкой
сводки — реальные нули. Модель определяет порядок и вариант фраз, сервер
подставляет значения из привязанных полей; новый факт или число добавить нельзя.
Блок не выполняет SQL и не меняет источники аналитики.

Текущий SQL `busiest_zone` считает посещения согласно задаче команды. Формулировка
явно говорит «посещения»; число уникальных людей из этого агрегата получить нельзя.
Сводка сейчас получает только людей, смены и отказы; для отклонений/аномалий кейса
нужен согласованный агрегат от Владислава. Это ограничения текущего API, здесь
не подменяются выдуманными данными.

14 автономных тестов face/model проходят. Сквозные SQL-тесты, переключение двух
реальных провайдеров в UI и полный стенд не проверены (Docker daemon выключен,
GigaChat ключ отсутствует). Общие `.env.example`, Compose и шесть документов
приёмки остаются в зоне алисона; этот текст — материал для них.

Для объяснения §5.3: локальная модель использует память/вычисления Mac, отдельной
оплаты LLM API нет; стоимость GigaChat зависит от тарифа ключа и здесь не измерялась.
GigaChat получает подготовленные агрегаты, включая имена в соответствующих tools,
но не кадры лиц и не embeddings. В локальном режиме эти факты остаются на стенде.
