import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat
from starlette.responses import JSONResponse

from face import FaceService, decode_image


class ImageInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    image_base64: str = Field(min_length=1, max_length=8_000_000)


class CompareInput(ImageInput):
    embedding: list[FiniteFloat] = Field(min_length=512, max_length=512)


@asynccontextmanager
async def lifespan(app):
    app.state.face = FaceService()
    app.state.lock = threading.Lock()
    yield


app = FastAPI(lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def invalid_input(request, error):
    return JSONResponse({"detail": "Некорректный запрос: проверьте изображение и вектор лица."}, status_code=422)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 8_100_000:
            return JSONResponse({"detail": "Изображение слишком большое."}, status_code=413)
        body.extend(chunk)
    request._body = bytes(body)
    return await call_next(request)


def run(request, operation, payload):
    try:
        image = decode_image(payload.image_base64)
        with request.app.state.lock:
            service = request.app.state.face
            if operation == "count_faces":
                return {"count": service.count_faces(image)}
            if operation == "embed":
                return {"embedding": service.embed(image)}
            return service.compare(payload.embedding, image)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except Exception as error:
        logging.exception("Face inference failed")
        raise HTTPException(503, "Распознавание лиц не готово.") from error


@app.post("/count_faces")
def count_faces(request: Request, payload: ImageInput):
    return run(request, "count_faces", payload)


@app.post("/embed")
def embed(request: Request, payload: ImageInput):
    return run(request, "embed", payload)


@app.post("/compare")
def compare(request: Request, payload: CompareInput):
    return run(request, "compare", payload)
