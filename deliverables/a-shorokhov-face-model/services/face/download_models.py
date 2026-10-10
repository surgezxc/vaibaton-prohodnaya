"""Download published weights; binaries stay in the ignored .models directory."""
import hashlib

import requests

from face import MODEL_ROOT, FaceService

YOLO_URL = "https://github.com/akanametov/yolo-face/releases/download/1.0.0/yolov8n-face.pt"
YOLO_SHA256 = "d545bf1add5aa736a4febac4f4f9245a6d596cd0fe70d5d57989fe0cb9e626ca"


def main():
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    target = MODEL_ROOT / "yolov8n-face.pt"
    if not target.exists():
        part = target.with_suffix(".part")
        try:
            with requests.get(YOLO_URL, stream=True, timeout=(10, 120)) as response:
                response.raise_for_status()
                with part.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
            if hashlib.sha256(part.read_bytes()).hexdigest() != YOLO_SHA256:
                raise RuntimeError("Контрольная сумма YOLO-face не совпадает.")
            part.replace(target)
        finally:
            part.unlink(missing_ok=True)
    if hashlib.sha256(target.read_bytes()).hexdigest() != YOLO_SHA256:
        raise RuntimeError("Повреждён файл YOLO-face.")
    FaceService()
    print("YOLOv8-face, buffalo_l и liveness готовы:", MODEL_ROOT)


if __name__ == "__main__":
    main()
