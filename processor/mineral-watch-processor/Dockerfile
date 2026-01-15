FROM python:3.11-slim

# Install poppler-utils for pdftoppm and pdfinfo
# Install tesseract-ocr for OCR of scanned documents
RUN apt-get update && apt-get install -y \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Run the processor
CMD ["python", "-m", "src.main"]
