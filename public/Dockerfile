# Level 17: The Exoskeleton - Docker Container for The Cortex
FROM python:3.11.15-slim@sha256:e031123e3d85762b141ad1cbc56452ba69c6e722ebf2f042cc0dc86c47c0d8b3

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    gnupg \
    redis-server \
    zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (required for OpenClaw CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && node --version \
    && npm --version

# Install the independently published OpenClaw tarball only after npm's
# package integrity matches the release-attested immutable SRI value.
ARG OPENCLAW_VERSION=2026.6.6
ARG OPENCLAW_INTEGRITY=sha512-oMYoQ8a7zummw1tD+AX98yYLzqoq0tQmYWHG65AA0ZivgzmOb2oD0cVdhcWP9IT3opkHdJ5vBdWywUe6xWQXtw==
RUN test "$(npm view "openclaw@${OPENCLAW_VERSION}" dist.integrity)" = "${OPENCLAW_INTEGRITY}" \
    && npm install -g "openclaw@${OPENCLAW_VERSION}" \
    && test "$(npm view "openclaw@${OPENCLAW_VERSION}" dist.integrity)" = "${OPENCLAW_INTEGRITY}" \
    && openclaw --version

# Copy requirements first for better caching
COPY cortex_server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire cortex_server directory (note: source has nested cortex_server/)
COPY cortex_server/cortex_server/ ./cortex_server/

# Nexus imports the adaptive routing package at startup. Keep the production
# image layout aligned with the source-tree PYTHONPATH used by tests.
COPY cortex_server/services/ ./services/
COPY cortex_graph.db /app/seed/cortex_graph.db

# Explicitly copy knowledge files (ensure graph.py and __init__.py are present)
COPY cortex_server/cortex_server/knowledge/*.py ./cortex_server/knowledge/
COPY cortex_server/cortex_server/knowledge/evolution/ ./cortex_server/knowledge/evolution/

# Create necessary directories. The runtime delivery path is replaced by the
# access-controlled durable volume in the production Compose deployment.
RUN mkdir -p /app/config /app/logs /app/seed /app/cortex_server/knowledge/evolution /opt/clawdbot/runtime_delivery /opt/clawdbot/state /opt/clawdbot/knowledge /opt/clawdbot/reasoning

# Set environment variables
ENV PYTHONPATH=/app
ENV CORTEX_HOST=0.0.0.0
ENV CORTEX_PORT=8888
ENV OPENCLAW_VERSION=${OPENCLAW_VERSION}
ENV OPENCLAW_INTEGRITY=${OPENCLAW_INTEGRITY}
# Bound glibc's native arena retention before Python, Chroma, and ONNX load.
ENV MALLOC_ARENA_MAX=2
ENV MALLOC_TRIM_THRESHOLD_=131072
ENV MALLOC_TOP_PAD_=131072

# Expose the port
EXPOSE 8888

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:8888/ready >/dev/null || exit 1

# Run the Cortex
CMD ["python", "-m", "uvicorn", "cortex_server.main:app", "--host", "0.0.0.0", "--port", "8888", "--limit-concurrency", "128", "--timeout-keep-alive", "5", "--ws-max-size", "4096"]
