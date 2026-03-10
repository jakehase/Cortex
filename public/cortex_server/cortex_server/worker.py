"""Celery worker configuration and tasks for cortex_server.

Uses native modules for direct execution without API calls.
"""
from __future__ import annotations

import os
import time
from datetime import datetime

from celery import Celery

# Import native modules for direct execution
from cortex_server.modules.ghost import Ghost


app = Celery(
    "cortex_tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0",
)


@app.task(name="cortex_tasks.long_running_research")
def long_running_research(topic: str) -> str:
    """Simulate a long-running research task and write a report to disk."""
    time.sleep(10)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    output_dir = "/tmp/cortex_research"
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{topic}_{timestamp}.txt"
    path = os.path.join(output_dir, filename)
    content = f"Research on {topic} completed at {timestamp}"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


@app.task(name="cortex_tasks.add")
def add(x, y):
    """Simple add task for testing."""
    return x + y


@app.task(name="cortex_tasks.process_swarm")
def process_swarm(goal: str, context: str | None = None) -> dict:
    """Process a swarm orchestration task using native modules.
    
    Uses Ghost for web search, makes local API calls for Oracle/Librarian.
    """
    import requests
    import uuid
    import json

    ORACLE_URL = "http://localhost:8888/oracle/chat"
    QUEUE_URL = "http://localhost:8888/queue/schedule"
    LIBRARIAN_EMBED = "http://localhost:8888/librarian/embed"

    # Use Ghost natively for web research
    ghost = Ghost()
    search_results = []
    try:
        search_query = f"{goal} history sources"
        search_results = ghost.search(search_query, max_results=3)
    except Exception as e:
        search_results = [{"title": "Search failed", "link": str(e)}]

    # Build context from search results
    sources_text = "\n".join([f"- {r['title']}: {r['link']}" for r in search_results[:2]])
    
    system_prompt = f"""You are a task planner. Use these sources for context:
{sources_text}

Break the user's goal into exactly 3 distinct, single-sentence sub-tasks. Format as numbered list (1., 2., 3.)."""

    oracle_payload = {
        "prompt": f"Goal: {goal}\n\nBreak this into 3 sub-tasks:",
        "system": system_prompt,
        "model": "tinyllama"
    }

    try:
        oracle_resp = requests.post(ORACLE_URL, json=oracle_payload, timeout=60)
        plan_text = oracle_resp.json().get("response", "")
    except Exception as e:
        plan_text = f"Error: {str(e)}"

    sub_tasks = []
    for line in plan_text.split('\n'):
        line = line.strip()
        if line and (line.startswith('1.') or line.startswith('2.') or line.startswith('3.')):
            task_text = line[2:].strip()
            if task_text:
                sub_tasks.append(task_text)

    if len(sub_tasks) < 3:
        sub_tasks = [
            f"Research: {goal}",
            f"Analyze: {goal}",
            f"Summarize: {goal}"
        ]

    task_ids = []
    for i, task in enumerate(sub_tasks[:3], 1):
        queue_payload = {
            "task": "cortex_tasks.long_running_research",
            "args": [f"Swarm Task {i}: {task}"]
        }
        try:
            queue_resp = requests.post(QUEUE_URL, json=queue_payload, timeout=10)
            task_id = queue_resp.json().get("task_id")
            if task_id:
                task_ids.append(task_id)
        except:
            task_ids.append(f"failed-{uuid.uuid4()}")

    master_plan_id = str(uuid.uuid4())

    librarian_payload = {
        "text": f"HIVE MASTER PLAN [{master_plan_id}]: {goal}\nPlan: {plan_text}\nSources: {json.dumps(search_results)}\nTasks: {json.dumps(task_ids)}",
        "metadata": {
            "type": "swarm_plan",
            "plan_id": master_plan_id,
            "task_ids": task_ids,
            "goal": goal,
            "sources": search_results
        }
    }

    try:
        requests.post(LIBRARIAN_EMBED, json=librarian_payload, timeout=10)
    except:
        pass

    return {
        "master_plan_id": master_plan_id,
        "plan": plan_text,
        "sources_found": len(search_results),
        "task_ids": task_ids,
        "status": "completed"
    }
