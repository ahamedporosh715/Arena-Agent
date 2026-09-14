# KaiOS 2.5 yt-dlp backend — Python stdlib API + raw API JSON + ffmpeg merger
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    DOWNLOAD_DIR=/app/downloads \
    PATH=/app/bin:$PATH \
    YTDLP_BIN=/app/bin/yt-dlp \
    YTDLP_AUTO_UPDATE=1 \
    YTDLP_UPDATE_CHANNEL=stable \
    API_MANIFEST_PATH=/app/api.raw.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
# requirements.txt is useful for local/pip installs; Docker uses the standalone
# yt-dlp binary so self-update can work inside /app/bin.
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /app/bin \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /app/bin/yt-dlp \
    && chmod 0755 /app/bin/yt-dlp

COPY server.py ./server.py
COPY api.raw.json ./api.raw.json
COPY static ./static

RUN useradd -r -u 10001 -g users appuser \
    && mkdir -p /app/downloads \
    && chown -R appuser:users /app
USER appuser

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import json, os, urllib.request; u='http://127.0.0.1:%s/status' % os.getenv('PORT','8080'); r=urllib.request.urlopen(u, timeout=4); assert r.status == 200 and json.load(r).get('ok') is True" || exit 1

CMD ["python", "server.py"]
