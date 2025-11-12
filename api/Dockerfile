FROM python:3.11-slim

WORKDIR /app

# helpful: CA certs + curl (optional)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

COPY requirements.txt /tmp/api-requirements.txt

# be explicit about the index to avoid mirror issues
RUN python -m pip install --no-cache-dir -i https://pypi.org/simple -r /tmp/api-requirements.txt

COPY . /app/api

CMD ["gunicorn", "-b", "0.0.0.0:5001", "-w", "2", "api.app:app"]
