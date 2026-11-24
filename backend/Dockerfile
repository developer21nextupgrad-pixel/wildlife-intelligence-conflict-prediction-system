FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface \
    TORCH_HOME=/app/.cache/torch \
    KAGGLEHUB_CACHE=/app/.cache/kagglehub

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /app/.cache/huggingface /app/.cache/torch /app/.cache/kagglehub

COPY backend/ .

ARG PRELOAD_MODELS=false
RUN if [ "$PRELOAD_MODELS" = "true" ]; then \
      python -c "from app.core.config import get_settings; from app.services.animal_detection import get_animal_detection_pipeline; from app.services.megadescriptor import get_megadescriptor_extractor; s=get_settings(); get_animal_detection_pipeline(s).preload(); get_megadescriptor_extractor(s).preload()"; \
    fi

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}"]
