# Used when deploying the backend for real (not needed for local dev — for
# local dev you run `uvicorn` directly, see the root README.md).
FROM python:3.11-slim

WORKDIR /app

# Tesseract is the OCR engine used for PNG/JPG drawings (app/services/text_extraction.py)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x entrypoint.sh

EXPOSE 8000
CMD ["./entrypoint.sh"]
