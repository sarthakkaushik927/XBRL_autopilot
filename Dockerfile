
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast, reliable dependency resolution and installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Set working directory inside container
WORKDIR /app



COPY pyproject.toml uv.lock* ./

# --no-cache: the downloaded wheels are not kept in the layer next to the installed packages (torch twice)
RUN uv sync --no-dev --frozen --no-cache

COPY . .

# Ensure output and static directories exist for file operations
RUN mkdir -p /app/output /app/static

# Expose backend port
EXPOSE 7860


# Start FastAPI application with Uvicorn via make
CMD ["make", "start-backend"]
