FROM python:3.11-slim

WORKDIR /app

# curl needed for the container healthcheck and for ad-hoc debugging.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

# uvicorn with one worker — Phase 1 is single-process / single-user. T3+ may
# tune workers per CPU when auth and persistence concerns settle.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
