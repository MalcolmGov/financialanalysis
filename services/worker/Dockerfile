FROM python:3.12-slim

# System deps for pdfium / pillow / docling native bits.
# liblzma5: transformers/torchvision import AutoImageProcessor via lzma.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 liblzma5 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
# --frozen: install exactly what's locked (torch resolves from the CPU-only
# PyTorch index per [tool.uv.sources] in pyproject.toml — never re-resolve
# without the lock, or torch's Linux wheel drags in the full CUDA toolkit).
RUN uv sync --frozen --no-dev

COPY app ./app

# Bake Docling model weights into the image so cold starts don't hit HuggingFace.
# Fail the build if download breaks — silent `|| true` left prod downloading at
# job time and masked dependency import failures until the first PDF.
RUN uv run python -c "from transformers import AutoImageProcessor; print('AutoImageProcessor OK')" \
 && uv run docling-tools models download

ENV QUEUE_BACKEND=postgres BLOB_BACKEND=vercel PORT=8000
EXPOSE 8000
# Railway injects $PORT — do not hardcode 8000 at runtime.
CMD ["sh", "-c", "exec uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
