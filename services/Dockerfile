# syntax=docker/dockerfile:1.7
# One shared image for: api, worker (+beat), relay, inference, bootstrap.  Multi-arch (Apple Silicon / x86-64).
FROM python:3.12-slim-bookworm AS base

ARG INSTALL_EXTRAS=true
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=2 \
    TZ=Asia/Kolkata

# libgomp: onnxruntime/sklearn · libglib: opencv-headless · curl: healthchecks · tini: proper PID 1
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 libglib2.0-0 curl tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-extra.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt \
    && pip install --no-deps rapidocr-onnxruntime==1.2.3 \
    && if [ "$INSTALL_EXTRAS" = "true" ]; then pip install -r requirements-extra.txt; fi \
    && python -c "import cv2, onnxruntime, rapidocr_onnxruntime, fastapi, celery; print('deps ok')"

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin oralscreen \
    && mkdir -p /models /tmp/oralscreen && chown -R oralscreen:oralscreen /models /tmp/oralscreen

COPY --chown=oralscreen:oralscreen alembic.ini ./
COPY --chown=oralscreen:oralscreen app ./app
COPY --chown=oralscreen:oralscreen scripts ./scripts

USER oralscreen
ENV OS_MODELS_DIR=/models HOME=/home/oralscreen
EXPOSE 8000 8090 9101
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
