FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt
COPY face.py app.py download_models.py ./
ENV FACE_MODEL_ROOT=/models
EXPOSE 8000
CMD ["sh", "-c", "python download_models.py && uvicorn app:app --host 0.0.0.0 --port 8000"]
