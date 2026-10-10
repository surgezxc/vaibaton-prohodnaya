"""Local camera diagnostic; run on loopback, separately from the production app."""
from pathlib import Path

from fastapi.responses import FileResponse

from app import app

ROOT = Path(__file__).resolve().parent


@app.get("/", include_in_schema=False)
def camera_page():
    return FileResponse(ROOT / "camera.html", headers={"Cache-Control": "no-store"})


@app.get("/camera.js", include_in_schema=False)
def camera_script():
    return FileResponse(ROOT / "camera.js", media_type="text/javascript")
