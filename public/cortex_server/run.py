#!/usr/bin/env python3
"""
The Cortex Server Startup Script
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cortex_server.main import app
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "cortex_server.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )