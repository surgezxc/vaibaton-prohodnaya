# Ворота качества лица

| Код | Условие | Enroll | Match |
| --- | --- | --- | --- |
| `FACE_NONE` | 0 детекций | блок сохранения | `FACE_QUALITY` deny |
| `FACE_MULTIPLE` | ≥2 детекций | блок сохранения | `FACE_QUALITY` deny |
| `FACE_SMALL` | бокс < порога | блок | deny quality |
| `FACE_BLUR` | Laplacian/var ниже порога (если считаете) | блок | deny quality |
| `FACE_NOT_ENROLLED` | нет вектора у person | — | deny |
| `FACE_NO_MATCH` | 1 лицо, score < threshold | — | deny |

Пороги и выбранную библиотеку записать в `docs/decisions.md`.
