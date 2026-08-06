FROM python:3.12-slim

# System deps for pdfium / pillow / docling native bits.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
# --frozen: install exactly what's locked (torch resolves from the CPU-only
# PyTorch index per [tool.uv.sources] in pyproject.toml — never re-resolve
# without the lock, or torch's Linux wheel drags in the full CUDA toolkit).
RUN uv sync --frozen --no-dev

COPY app ./app

# Bake Docling model weights into the image so cold starts don't hit HuggingFace.
RUN uv run docling-tools models download || true

ENV QUEUE_BACKEND=postgres BLOB_BACKEND=vercel PORT=8000
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
