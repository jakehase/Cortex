# The Cortex 🧠

A local knowledge graph and tool server that gives me permanent capabilities upgrade.

## What is The Cortex?

The Cortex is a Python-based local server that provides:

- **Knowledge Graph Core**: SQLite-backed graph database for storing code relationships, documents, and entities
- **File Parsers**: Extract structure from Python, JavaScript/TypeScript, and PDF files
- **CLI Tool Wrappers**: Safe, typed interfaces to FFmpeg, Git, and Docker
- **FastAPI Backend**: RESTful API with WebSocket support for real-time operations

## Architecture

```
cortex_server/
├── main.py                    # FastAPI app factory
├── knowledge/
│   └── graph.py              # Knowledge graph core (SQLite)
├── parsers/
│   ├── python_parser.py      # Python AST extraction
│   ├── pdf_parser.py         # PDF text/structure extraction
│   └── js_parser.py          # JS/TS AST extraction (tree-sitter)
├── tools/
│   ├── ffmpeg_wrapper.py     # FFmpeg async wrapper
│   ├── git_wrapper.py        # Git CLI wrapper
│   └── docker_wrapper.py     # Docker CLI wrapper
├── routers/
│   ├── knowledge.py          # Graph API endpoints
│   ├── parsers.py            # Parser API endpoints
│   ├── tools.py              # Tool API endpoints
│   └── websockets.py         # WebSocket endpoints
├── services/
│   ├── knowledge_service.py  # Graph business logic
│   ├── parser_service.py     # Parser orchestration
│   └── tool_service.py       # Tool orchestration
├── models/
│   └── requests.py           # Pydantic models
└── middleware/
    └── error_handler.py      # Error handling
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
./start.sh

# Or with custom port
./start.sh 8080
```

Server will be available at `http://localhost:8000`

## API Endpoints

### Knowledge Graph
- `POST /graph/query` - Query nodes
- `POST /graph/nodes` - Create node
- `GET /graph/nodes/{id}` - Get node
- `POST /graph/edges` - Create edge
- `GET /graph/nodes/{id}/neighbors` - Get neighbors

### Parsers
- `POST /parse/python` - Parse Python file/code
- `POST /parse/pdf` - Parse PDF file
- `POST /parse/javascript` - Parse JS/TS file/code
- `POST /parse/directory` - Parse entire directory

### Tools
- `POST /tools/ffmpeg/convert` - Convert media
- `POST /tools/ffmpeg/extract-audio` - Extract audio
- `POST /tools/git/clone` - Clone repository
- `POST /tools/git/pull` - Pull changes
- `POST /tools/docker/run` - Run container
- `GET /tools/docker/containers` - List containers

### WebSockets
- `/ws/progress` - Task progress updates
- `/ws/logs/{container_id}` - Docker log streaming
- `/ws/health` - Health check

## Example Usage

```python
import requests

# Parse a Python file
response = requests.post("http://localhost:8000/parse/python", json={
    "file_path": "/path/to/file.py"
})

# Query the knowledge graph
response = requests.post("http://localhost:8000/graph/query", json={
    "query": "my_function",
    "node_type": "Function"
})

# Convert a video
response = requests.post("http://localhost:8000/tools/ffmpeg/convert", json={
    "input_path": "/path/to/input.mov",
    "output_path": "/path/to/output.mp4",
    "codec": "libx264"
})
```

## Configuration

Environment variables:
- `CORTEX_DB_PATH` - SQLite database path (default: `cortex_graph.db`)
- `CORTEX_HOST` - Server host (default: `0.0.0.0`)
- `CORTEX_PORT` - Server port (default: `8000`)

## Dependencies

Core:
- FastAPI + Uvicorn
- Pydantic
- SQLite (built-in)

Parsers:
- pdfplumber (PDF)
- tree-sitter + tree-sitter-javascript/typescript (JS/TS)

Tools:
- ffmpeg (external)
- git (external)
- docker (external)

## License

MIT