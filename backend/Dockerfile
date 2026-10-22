FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
RUN useradd --create-home --uid 1000 appuser && mkdir /data && chown appuser:appuser /data
COPY backend /app/backend
COPY data /app/data
ENV DATABASE_PATH=/data/local.db
USER appuser
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
