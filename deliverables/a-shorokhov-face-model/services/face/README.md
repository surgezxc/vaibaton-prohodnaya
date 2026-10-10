# Face — часть a-shorokhov

Контракт уже задан в основном репозитории, в `apps/api/src/face/client.ts`; здесь реализованы его три
HTTP-вызова. Человека выбирает API, embedding хранит API, проход решает `decide()`.
Сервис не хранит фотографии и не ищет человека по всей базе.

## Запуск без API

Из корня этой папки deliverable, Python 3.12:

```sh
cd services/face
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python download_models.py
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

Первое скачивание требует сети. YOLO-face берётся из опубликованного release и
проверяется SHA256; buffalo_l и RGB-liveness скачивает InsightFace. Каталог
`.models/` исключён из Git. После скачивания модели работают локально.

Во втором терминале, из `services/face`:

```sh
.venv/bin/python -m unittest -v test_face.py
.venv/bin/python smoke.py '../../../../Первый пакет'
.venv/bin/python check_package.py '../../../../Первый пакет'
```

На macOS путь может отображаться с составными Unicode-символами; используйте
автодополнение имени каталога. `smoke.py` проверяет настоящий HTTP-сервис: 0/1/2
лица, отказ enroll при 0/2, embedding 512, свой Гаджиев `_проходная_3.jpg` и чужой
Иванов `_проходная_1.png`. Это проверка сохранённых снимков, не живой камеры.

`check_package.py` проверяет весь пакет и пишет `.reports/package.json`.
Ненулевой код выхода означает обнаруженное ограничение качества, а не успешную
приёмку. Фотографии источника скрипты не меняют.

## Вызовы для Владислава

Все запросы — JSON. `image_base64` — содержимое JPEG/PNG/WebP в base64; допустим
также data URL. До 6 MB после декодирования и 16 мегапикселей. Только внутренняя
сеть API; порт face не должен публиковаться в интернете.

| POST | Тело | Ответ |
| --- | --- | --- |
| `/count_faces` | `{image_base64}` | `{count}` — фактическое число лиц YOLOv8-face |
| `/embed` | `{image_base64}` | `{embedding: number[512]}` — только при одном лице |
| `/compare` | `{embedding: number[512], image_base64}` | `{face_count, score, match, live}` |

`/embed` не запускает liveness. На проходе YOLO проверяет количество, SCRFD из
buffalo_l получает landmarks того же лица (сопоставление боксов), ArcFace из
buffalo_l даёт embedding. Cosine — скалярное произведение нормированных векторов.
RGB-liveness запускается только в `/compare`. При 0/2+ возвращаются `score=null`,
`match=false`, `live=false`. `match` означает только совпадение личности; сервер
обязан дополнительно проверить `live` и свои условия попытки.

Плохой ввод/неоднозначное лицо — HTTP 422; слишком большое тело — 413; ошибка
модели — 503. API уже превращает их в отказ и запись журнала. Исключение модели
никогда не превращается в разрешение.

## Передача алисону

Dockerfile лежит здесь; build context `./services/face`, внутренний порт 8000.
Первый старт скачивает веса, поэтому нужен постоянный volume в `/models`.
В существующий Compose алисон добавляет:

```yaml
face:
  build: ./services/face
  environment:
    FACE_MODEL_ROOT: /models
    FACE_MATCH_THRESHOLD: "0.74"
    FACE_DETECT_CONFIDENCE: "0.25"
    FACE_LIVENESS_THRESHOLD: "0.8"
  volumes:
    - face_models:/models
```

И объявляет volume `face_models`. У API уже есть `FACE_SERVICE_URL=http://face:8000`.
Для работы API на хосте адрес `http://127.0.0.1:8000`; API в Docker при face на
Mac — `http://host.docker.internal:8000`, face нужно слушать доступный интерфейс.
Веса заранее скачать до репетиции; первый старт дольше `FACE_TIMEOUT_MS` API.

Env для `.env.example`: четыре FACE-переменные выше плюс API
`FACE_SERVICE_URL`, `FACE_TIMEOUT_MS` (текущий API по умолчанию 8000 ms).
Compose и общие документы здесь не изменены.

## Фактические результаты и ограничения

Проверено 10.10.2026 на Mac M4 Pro/24 GB, CPUExecutionProvider: 10 эталонов,
58 кадров проходной, из них 52 с одним лицом и 6 с двумя обнаруженными лицами.
Для 52 кадров выполнено 468 чужих сравнений. Минимум своего cosine 0.44248,
максимум чужого 0.73037: единого порога без ошибок для пакета нет.

По умолчанию 0.74: наблюдаемых чужих совпадений нет, но 21 свой кадр отклоняется
по cosine, ещё 6 — по количеству лиц. Это консервативное демо-значение, которое
нужно сообщить команде и записать в существующее решение 6. Снижать его до 0.45
ради зелёного демо нельзя: появляются чужие совпадения. Нужны более качественные
эталоны/кадры и повторная оценка, особенно на новом человеке судей (Д9).

RGB-модель оценила сохранённые кадры как live; это не доказательство защиты от
распечатки/экрана. Проверка на настоящей камере, экране и бумаге пока не выполнена.
Фотографии/векторы проходят только между API и локальным face; в отчётах нет
embedding. Времена полного прогона и HTTP-теста — в локальных `.reports`.
Docker-сборка не проверена: Docker daemon на этом Mac не запущен.

Источники: [YOLO-face](https://github.com/akanametov/yolo-face),
[InsightFace liveness](https://github.com/deepinsight/insightface/blob/master/python-package/docs/liveness.md).
