import base64
import threading
import unittest
from unittest.mock import Mock

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import app
from face import FaceService, box_xywh, cosine, decode_image, normalized_embedding


class FaceTests(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((100, 100, 3), dtype=np.uint8)
        self.vector = np.zeros(512, dtype=np.float32)
        self.vector[0] = 1

    def test_cosine_and_invalid_vectors(self):
        self.assertAlmostEqual(cosine(self.vector, self.vector), 1)
        self.assertAlmostEqual(cosine(self.vector, -self.vector), -1)
        for vector in [[1], np.zeros(512), np.full(512, np.nan), np.full(512, np.inf)]:
            with self.assertRaises(ValueError):
                normalized_embedding(vector)

    def test_box_pixels(self):
        self.assertEqual(box_xywh([10, 20, 40, 80]), {"x": 10, "y": 20, "width": 30, "height": 60})
        self.assertEqual(box_xywh(np.array([-4.2, 8, 20.2, 30])), {"x": 0, "y": 8, "width": 20, "height": 22})
        self.assertIsNone(box_xywh([5, 5, 5, 9]))
        self.assertIsNone(box_xywh([np.nan, 0, 1, 1]))
        service = FaceService.__new__(FaceService)
        service.boxes = Mock(return_value=np.array([[10, 20, 40, 80], [100, 30, 140, 90]], dtype=np.float32))
        self.assertEqual(service.pixel_boxes(self.image), [
            {"x": 10, "y": 20, "width": 30, "height": 60},
            {"x": 100, "y": 30, "width": 40, "height": 60},
        ])
        service.boxes.return_value = np.zeros((0, 4))
        self.assertEqual(service.pixel_boxes(self.image), [])

    def test_image_validation(self):
        for value in ["", "not-base64", base64.b64encode(b"not an image").decode()]:
            with self.assertRaises(ValueError):
                decode_image(value)
        encoded = base64.b64encode(cv2.imencode(".png", self.image)[1]).decode()
        self.assertEqual(decode_image(encoded).shape, self.image.shape)

    def test_enrollment_does_not_check_liveness(self):
        service = FaceService.__new__(FaceService)
        service.boxes = Mock(return_value=[np.array([0, 0, 10, 10])])
        service.single_face = Mock(return_value=Mock(embedding=self.vector))
        service.analysis = Mock()
        self.assertEqual(len(service.embed(self.image)), 512)
        service.analysis.assert_not_called()
        for boxes in [[], [1, 2]]:
            service.boxes.return_value = boxes
            with self.assertRaises(ValueError):
                service.embed(self.image)

    def test_same_recognizer_combines_four_views_and_rejects_invalid_output(self):
        service = FaceService.__new__(FaceService)
        model = Mock(input_size=(112, 112))
        model.get_feat.return_value = np.tile(self.vector, (4, 1))
        service.analysis = Mock(models={"recognition": model})
        landmarks = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                              [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float32)
        result = service.recognition_embedding(self.image, landmarks)
        np.testing.assert_allclose(result, self.vector)
        crops = model.get_feat.call_args.args[0]
        self.assertEqual(len(crops), 4)
        np.testing.assert_array_equal(crops[1], cv2.flip(crops[0], 1))
        np.testing.assert_array_equal(crops[3], cv2.flip(crops[2], 1))
        for value in [np.zeros((4, 512)), np.full((4, 512), np.nan), np.ones((3, 512))]:
            model.get_feat.return_value = value
            with self.assertRaises(ValueError):
                service.recognition_embedding(self.image, landmarks)

    def test_passage_rejects_zero_many_and_fake(self):
        service = FaceService.__new__(FaceService)
        service.threshold = 0.45
        service.boxes = Mock(return_value=[])
        service.single_face = Mock(return_value=Mock(embedding=self.vector))
        live = Mock()
        service.analysis = Mock(addons={"liveness": live})
        for boxes in [[], [1, 2]]:
            service.boxes.return_value = boxes
            result = service.compare(self.vector, self.image)
            self.assertFalse(result["match"])
            self.assertFalse(result["live"])
            self.assertIsNone(result["score"])
        service.boxes.return_value = [1]
        for verdict in [{"status": "ok", "is_live": False}, {"status": "input_rejected", "is_live": None}]:
            live.get.return_value = verdict
            self.assertFalse(service.compare(self.vector, self.image)["live"])
        live.get.return_value = {"status": "ok", "is_live": True}
        self.assertTrue(service.compare(self.vector, self.image)["live"])
        service.single_face.return_value = Mock(embedding=-self.vector)
        self.assertFalse(service.compare(self.vector, self.image)["match"])

    def test_http_contract_and_fail_closed(self):
        app.state.face = Mock()
        app.state.lock = threading.Lock()
        client = TestClient(app)
        encoded = base64.b64encode(cv2.imencode(".png", self.image)[1]).decode()
        self.assertEqual(client.post("/count_faces", json={"image_base64": "garbage"}).status_code, 422)
        app.state.face.pixel_boxes.return_value = [
            {"x": 4, "y": 8, "width": 20, "height": 30},
            {"x": 40, "y": 12, "width": 18, "height": 22},
        ]
        self.assertEqual(client.post("/count_faces", json={"image_base64": encoded}).json(), {
            "count": 2,
            "boxes": [
                {"x": 4, "y": 8, "width": 20, "height": 30},
                {"x": 40, "y": 12, "width": 18, "height": 22},
            ],
        })
        app.state.face.pixel_boxes.return_value = []
        self.assertEqual(client.post("/count_faces", json={"image_base64": encoded}).json(), {"count": 0, "boxes": []})
        app.state.face.embed.side_effect = ValueError("Нужно одно лицо.")
        self.assertEqual(client.post("/embed", json={"image_base64": encoded}).status_code, 422)
        app.state.face.compare.side_effect = RuntimeError("model offline")
        self.assertEqual(client.post("/compare", json={"image_base64": encoded, "embedding": self.vector.tolist()}).status_code, 503)
        self.assertEqual(client.post("/compare", json={"image_base64": encoded, "embedding": [0]}).status_code, 422)
        raw = '{"image_base64":"' + encoded + '","embedding":[' + ','.join(["NaN"] * 512) + ']}'
        self.assertEqual(client.post("/compare", content=raw, headers={"content-type": "application/json"}).status_code, 422)
        self.assertEqual(client.post("/embed", content=b"x" * 8_100_001).status_code, 413)


if __name__ == "__main__":
    unittest.main()
