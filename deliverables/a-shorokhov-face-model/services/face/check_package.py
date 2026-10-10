"""Real model calibration on the supplied package, not a live passage test."""
import argparse
import base64
import json
import time
import unicodedata
from pathlib import Path

import cv2
import numpy as np
import httpx

from face import FaceService, cosine


def read(path):
    image = cv2.imdecode(np.frombuffer(path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Не прочитано изображение: {path.name}")
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".reports/package.json"))
    parser.add_argument("--min-accepted", type=int, default=45)
    parser.add_argument("--http-url", help="Also verify every pair through the running HTTP service")
    args = parser.parse_args()
    started = time.monotonic()
    service = FaceService()
    client = httpx.Client(base_url=args.http_url, timeout=15) if args.http_url else None
    http_pairs = 0

    def compare(embedding, image):
        nonlocal http_pairs
        if client is None:
            return service.compare(embedding, image)
        encoded = base64.b64encode(cv2.imencode(".png", image)[1]).decode()
        response = client.post("/compare", json={"embedding": embedding, "image_base64": encoded})
        response.raise_for_status()
        http_pairs += 1
        return response.json()
    files = sorted(path for path in args.package.rglob("*") if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    references = {}
    for path in files:
        if "_фото" in unicodedata.normalize("NFC", path.name):
            references[path.parent.name] = service.embed(read(path))
    if len(references) < 2:
        raise ValueError("Нужны эталоны как минимум двух людей.")
    # Construct test inputs in memory; source photographs are never changed.
    portraits = [read(path) for path in files if "_фото" in path.name][:2]
    portraits = [cv2.resize(image, (600, 800)) for image in portraits]
    double = np.hstack([portraits[0], np.full((800, 200, 3), 255, np.uint8), portraits[1]])
    zero_count = service.count_faces(np.zeros((800, 800, 3), dtype=np.uint8))
    double_count = service.count_faces(double)
    assert zero_count == 0, zero_count
    assert double_count == 2, double_count
    for image in [np.zeros((800, 800, 3), dtype=np.uint8), double]:
        try:
            service.embed(image)
        except ValueError:
            pass
        else:
            raise AssertionError("Эталон без одного лица был принят.")
    probes, errors, count_rejections, wrong_accepts = [], [], [], []
    for path in files:
        if "_проходная_" not in path.name:
            continue
        try:
            image = read(path)
            boxes = service.boxes(image)
            if len(boxes) != 1:
                result = compare(next(iter(references.values())), image)
                assert result["match"] is False and result["live"] is False and result["score"] is None
                count_rejections.append({"file": str(path.relative_to(args.package)), "face_count": len(boxes)})
                continue
            face = service.single_face(image, boxes[0])
            scores = {name: cosine(embedding, face.embedding) for name, embedding in references.items()}
            own = scores[path.parent.name]
            wrong = max(score for name, score in scores.items() if name != path.parent.name)
            wrong_accepts.extend({"file": str(path.relative_to(args.package)), "reference": name, "score": score}
                                 for name, score in scores.items() if name != path.parent.name and score >= service.threshold)
            actual = compare(references[path.parent.name], image)
            assert actual["face_count"] == 1 and abs(actual["score"] - own) < 1e-5
            assert actual["match"] == (own >= service.threshold)
            if client is not None:
                for name, embedding in references.items():
                    if name == path.parent.name:
                        continue
                    result = compare(embedding, image)
                    assert result["face_count"] == 1 and abs(result["score"] - scores[name]) < 1e-5
                    assert result["match"] == (scores[name] >= service.threshold)
            probes.append({"file": str(path.relative_to(args.package)), "own_score": own,
                           "max_wrong_score": wrong, "live": actual["live"],
                           "accepted": actual["match"] and actual["live"]})
        except ValueError as error:
            errors.append({"file": str(path.relative_to(args.package)), "error": str(error)})
    if not probes:
        raise RuntimeError("Нет сравнимых кадров проходной.")
    min_own = min(row["own_score"] for row in probes)
    max_wrong = max(row["max_wrong_score"] for row in probes)
    report = {"calibration_only": True, "references": len(references), "probes": len(probes),
              "wrong_pairs": len(probes) * (len(references) - 1),
              "zero_count": zero_count, "double_count": double_count,
              "threshold": service.threshold, "min_own_score": min_own, "max_wrong_score": max_wrong,
              "suggested_threshold": round((min_own + max_wrong) / 2, 3) if min_own > max_wrong else None,
              "false_accepts": len(wrong_accepts), "wrong_accepts": wrong_accepts,
              "false_rejects": sum(row["own_score"] < service.threshold for row in probes),
              "accepted_own": sum(row["accepted"] for row in probes), "target_accepted": args.min_accepted,
              "live_on_saved_photos": sum(row["live"] is True for row in probes),
              "embedding_pipeline": "buffalo_l_flip_clahe_v1", "count_rejections": count_rejections,
              "http_verified": client is not None, "http_comparisons": http_pairs,
              "elapsed_seconds": round(time.monotonic() - started, 2), "errors": errors, "results": probes}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, ensure_ascii=False, indent=2))
    if client is not None:
        client.close()
    assert report["false_accepts"] == 0, "Чужое лицо проходит выбранный порог."
    assert not errors, "Ошибки обработки кадров. См. отчёт."
    assert report["accepted_own"] >= args.min_accepted, "Цель по своим лицам не достигнута. См. отчёт."


if __name__ == "__main__":
    main()
