"""YOLOv8-face detection, buffalo_l 1:1 recognition, passage-only RGB liveness."""

import base64
import binascii
import io
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
MODEL_ROOT = Path(os.environ.get("FACE_MODEL_ROOT", str(ROOT / ".models")))


def decode_image(value: str) -> np.ndarray:
    if value.startswith("data:image/"):
        value = value.split(",", 1)[-1]
    try:
        raw = base64.b64decode(value, validate=True)
        if not raw or len(raw) > 6_000_000:
            raise ValueError("Изображение слишком большое или пустое.")
        with Image.open(io.BytesIO(raw)) as header:
            if header.format not in {"JPEG", "PNG", "WEBP"} or header.width * header.height > 16_000_000:
                raise ValueError("Нужен JPEG, PNG или WebP размером до 16 мегапикселей.")
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Не удалось прочитать изображение.")
        return image
    except (binascii.Error, OSError, Image.DecompressionBombError) as error:
        raise ValueError("Некорректное изображение.") from error


def normalized_embedding(value) -> np.ndarray:
    vector = np.asarray(value, dtype=np.float32)
    if vector.shape != (512,) or not np.all(np.isfinite(vector)):
        raise ValueError("Нужен конечный 512-мерный вектор buffalo_l.")
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError("Вектор лица не может быть нулевым.")
    return vector / norm


def cosine(left, right) -> float:
    return float(np.clip(np.dot(normalized_embedding(left), normalized_embedding(right)), -1, 1))


def box_xywh(raw) -> dict | None:
    """YOLO xyxy → один прямоугольник в пикселях кадра. Порог совпадения не трогает."""
    coords = np.asarray(raw, dtype=np.float64).reshape(-1)
    if coords.size < 4 or not np.all(np.isfinite(coords[:4])):
        return None
    x1, y1, x2, y2 = (float(coords[0]), float(coords[1]), float(coords[2]), float(coords[3]))
    left = max(0, int(round(min(x1, x2))))
    top = max(0, int(round(min(y1, y2))))
    right = int(round(max(x1, x2)))
    bottom = int(round(max(y1, y2)))
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        return None
    return {"x": left, "y": top, "width": width, "height": height}


def overlap(left, right) -> float:
    a, b = np.asarray(left), np.asarray(right)
    size = np.maximum(0, np.minimum(a[2:], b[2:]) - np.maximum(a[:2], b[:2]))
    intersection = float(np.prod(size))
    union = float(np.prod(a[2:] - a[:2]) + np.prod(b[2:] - b[:2]) - intersection)
    return intersection / union if union > 0 else 0


class FaceService:
    def __init__(self):
        from insightface.app import FaceAnalysis
        from ultralytics import YOLO

        # shortcut: 0.69 separates tested foreign pairs, but some genuine frames fail; recalibrate on independent live captures.
        self.threshold = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.69"))
        self.confidence = float(os.environ.get("FACE_DETECT_CONFIDENCE", "0.25"))
        live_threshold = float(os.environ.get("FACE_LIVENESS_THRESHOLD", "0.8"))
        if not 0 < self.threshold <= 1 or not 0 < self.confidence <= 1 or not 0 < live_threshold <= 1:
            raise ValueError("Пороги face должны быть в интервале (0, 1].")
        weights = MODEL_ROOT / "yolov8n-face.pt"
        if not weights.is_file():
            raise RuntimeError("Нет весов YOLO-face. Выполните python download_models.py.")
        self.detector = YOLO(str(weights), task="detect")
        self.analysis = FaceAnalysis(
            name="buffalo_l", root=str(MODEL_ROOT),
            allowed_modules=["detection", "recognition"], addons=["liveness"],
            liveness_mode="observe", liveness_threshold=live_threshold,
            providers=["CPUExecutionProvider"],
        )
        self.analysis.prepare(ctx_id=-1, det_size=(640, 640))

    def boxes(self, image):
        result = self.detector.predict(image, conf=self.confidence, imgsz=1280, device="cpu", verbose=False)[0]
        return result.boxes.xyxy.cpu().numpy()

    def pixel_boxes(self, image) -> list[dict]:
        found = []
        for raw in self.boxes(image):
            box = box_xywh(raw)
            if box:
                found.append(box)
        return found

    def count_faces(self, image) -> int:
        return len(self.boxes(image))

    def single_face(self, image, box):
        from insightface.app.common import Face

        boxes, landmarks = self.analysis.det_model.detect(image, max_num=0)
        candidates = [i for i, bbox in enumerate(boxes) if overlap(box, bbox[:4]) >= 0.3]
        if len(candidates) != 1 or landmarks is None:
            raise ValueError("Не удалось однозначно выделить лицо для сравнения.")
        index = candidates[0]
        face = Face(bbox=boxes[index, :4], kps=landmarks[index], det_score=boxes[index, 4])
        face.embedding = self.recognition_embedding(image, face.kps)
        return face

    def recognition_embedding(self, image, landmarks):
        from insightface.utils import face_align

        model = self.analysis.models["recognition"]
        crop = face_align.norm_crop(image, landmark=landmarks, image_size=model.input_size[0])
        lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = cv2.createCLAHE(clipLimit=2, tileGridSize=(8, 8)).apply(lab[:, :, 0])
        equalized = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        features = model.get_feat([crop, cv2.flip(crop, 1), equalized, cv2.flip(equalized, 1)])
        if np.asarray(features).shape != (4, 512) or not np.all(np.isfinite(features)):
            raise ValueError("Некорректные векторы распознавания лица.")
        return normalized_embedding(np.sum(features, axis=0))

    def embed(self, image) -> list[float]:
        boxes = self.boxes(image)
        if len(boxes) != 1:
            raise ValueError("На изображении должно быть ровно одно лицо.")
        face = self.single_face(image, boxes[0])
        return normalized_embedding(face.embedding).tolist()

    def compare(self, embedding, image) -> dict:
        reference = normalized_embedding(embedding)
        boxes = self.boxes(image)
        if len(boxes) != 1:
            return {"face_count": len(boxes), "score": None, "match": False, "live": False}
        face = self.single_face(image, boxes[0])
        score = cosine(reference, face.embedding)
        # Registration deliberately never calls this addon: its input is a saved photo.
        live = self.analysis.addons["liveness"].get(image, face)
        return {"face_count": 1, "score": score, "match": score >= self.threshold,
                "live": live["status"] == "ok" and live["is_live"] is True}
