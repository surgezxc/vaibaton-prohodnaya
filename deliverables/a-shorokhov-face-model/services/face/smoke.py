"""Check the API-facing HTTP contract with real images and real models."""
import argparse
import base64
import json
import time
from pathlib import Path

import cv2
import numpy as np
import requests

from check_package import read


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    images = [path for path in args.package.rglob("*") if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    ref = next(path for path in images if "Гаджиев" in path.name and "_фото" in path.name)
    own = next(path for path in images if "Гаджиев" in path.name and "_проходная_3." in path.name)
    wrong = next(path for path in images if "Иванов" in path.name and "_проходная_1." in path.name)

    def encode(image):
        return base64.b64encode(cv2.imencode(".png", image)[1]).decode()

    def call(method, body):
        response = requests.post(args.url.rstrip("/") + "/" + method, json=body, timeout=30)
        response.raise_for_status()
        return response.json()

    def assert_count(payload, expected):
        assert payload["count"] == expected, payload
        boxes = payload["boxes"]
        assert isinstance(boxes, list) and len(boxes) == expected, payload
        for box in boxes:
            assert set(box) == {"x", "y", "width", "height"}, box
            assert all(isinstance(box[key], int) and box[key] >= 0 for key in ("x", "y", "width", "height")), box
            assert box["width"] > 0 and box["height"] > 0, box

    started = time.monotonic()
    photo = {"image_base64": base64.b64encode(ref.read_bytes()).decode()}
    assert_count(call("count_faces", photo), 1)
    embedding = call("embed", photo)["embedding"]
    assert len(embedding) == 512
    blank = encode(np.zeros((800, 800, 3), dtype=np.uint8))
    portrait = cv2.resize(read(ref), (600, 800))
    double = encode(np.hstack([portrait, np.full((800, 200, 3), 255, np.uint8), portrait]))
    for image, expected in [(blank, 0), (double, 2)]:
        assert_count(call("count_faces", {"image_base64": image}), expected)
        refused = requests.post(args.url + "/embed", json={"image_base64": image}, timeout=30)
        assert refused.status_code == 422
        result = call("compare", {"embedding": embedding, "image_base64": image})
        assert result["face_count"] == expected and not result["match"] and not result["live"]
    own_result = call("compare", {"embedding": embedding, "image_base64": base64.b64encode(own.read_bytes()).decode()})
    wrong_result = call("compare", {"embedding": embedding, "image_base64": base64.b64encode(wrong.read_bytes()).decode()})
    assert own_result["face_count"] == 1 and own_result["match"] and own_result["live"], own_result
    assert wrong_result["face_count"] == 1 and not wrong_result["match"], wrong_result
    invalid_cases = [("embed", {"image_base64": "not-base64"}),
                     ("compare", {**photo, "embedding": [0] * 512}),
                     ("compare", {**photo, "embedding": [1]})]
    for method, body in invalid_cases:
        response = requests.post(args.url.rstrip("/") + "/" + method, json=body, timeout=30)
        assert response.status_code == 422, (method, response.status_code)
    report = {"real_models": True, "saved_photos_not_camera": True, "count_zero": 0, "count_one": 1,
              "own_file": own.name, "wrong_file": wrong.name,
              "count_two": 2, "embedding_size": len(embedding), "own": own_result, "wrong": wrong_result,
              "invalid_inputs_refused": len(invalid_cases), "embedding_pipeline": "buffalo_l_flip_clahe_v1",
              "elapsed_seconds": round(time.monotonic() - started, 2)}
    output = Path(".reports/http-smoke.json")
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
