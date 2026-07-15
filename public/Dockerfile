# Level 17: The Exoskeleton - Docker Container for The Cortex
FROM python:3.11-slim

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

# Install OpenClaw CLI inside the container
RUN npm i -g openclaw@latest \
    && openclaw --version

# Copy requirements first for better caching
COPY cortex_server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire cortex_server directory (note: source has nested cortex_server/)
COPY cortex_server/cortex_server/ ./cortex_server/

# Nexus imports the adaptive routing package at startup. Keep the production
# image layout aligned with the source-tree PYTHONPATH used by tests.
COPY cortex_server/services/ ./services/

# Explicitly copy knowledge files (ensure graph.py and __init__.py are present)
COPY cortex_server/cortex_server/knowledge/*.py ./cortex_server/knowledge/
COPY cortex_server/cortex_server/knowledge/evolution/ ./cortex_server/knowledge/evolution/

# Create necessary directories. The runtime delivery path is replaced by the
# access-controlled durable volume in the production Compose deployment.
RUN mkdir -p /app/config /app/logs /app/cortex_server/knowledge/evolution /opt/clawdbot/state/runtime_delivery

# Set environment variables
ENV PYTHONPATH=/app
ENV CORTEX_HOST=0.0.0.0
ENV CORTEX_PORT=8888

# Expose the port
EXPOSE 8888

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:8888/ready >/dev/null \
    && curl -fsS http://localhost:8888/orchestrator/runtime-delivery/readiness >/dev/null \
    || exit 1

# Run the Cortex
CMD python -m uvicorn cortex_server.main:app --host 0.0.0.0 --port 8888 --reload
