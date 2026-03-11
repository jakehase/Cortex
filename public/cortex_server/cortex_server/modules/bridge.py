"""Level 25: The Bridge - Multi-Agent Federation
Connects The Cortex to other AI instances and external agents.
"""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from .auto_reporting import report_to_synthesist

class Bridge:
    """Level 25: The Bridge - Federated Agent Coordination"""
    
    def __init__(self):
        self.level = 25
        self.name = "Bridge"
        self.agent_registry = Path('/app/cortex_server/agents/registry.jsonl')
        self.message_queue = Path('/app/cortex_server/agents/queue')
        self.agent_registry.parent.mkdir(parents=True, exist_ok=True)
        self.message_queue.mkdir(parents=True, exist_ok=True)
        self._connected_agents = {}
    
    def status(self):
        return {
            "level": self.level,
            "name": self.name,
            "status": "active",
            "connected_agents": len(self._connected_agents)
        }
    
    def register_agent(self, agent_id: str, agent_config: dict) -> dict:
        """Register a new agent in the federation."""
        agent_entry = {
            "agent_id": agent_id,
            "registered_at": datetime.now().isoformat(),
            "config": agent_config,
            "last_seen": datetime.now().isoformat(),
            "status": "active"
        }
        
        with open(self.agent_registry, 'a') as f:
            f.write(json.dumps(agent_entry) + '\n')
        
        self._connected_agents[agent_id] = agent_entry
        
        return {
            "success": True,
            "agent_id": agent_id,
            "message": f"Agent {agent_id} registered in federation"
        }
    
    def send_message(self, from_agent: str, to_agent: str, message: dict) -> dict:
        """Send a message between agents."""
        msg_entry = {
            "id": f"msg_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hash(str(message)) % 10000}",
            "from": from_agent,
            "to": to_agent,
            "timestamp": datetime.now().isoformat(),
            "message": message,
            "status": "pending"
        }
        
        # Write to recipient's queue
        queue_file = self.message_queue / f"{to_agent}.jsonl"
        with open(queue_file, 'a') as f:
            f.write(json.dumps(msg_entry) + '\n')
        
        return {
            "success": True,
            "message_id": msg_entry["id"],
            "status": "delivered"
        }
    
    def get_messages(self, agent_id: str, mark_read: bool = True) -> List[dict]:
        """Retrieve messages for an agent."""
        queue_file = self.message_queue / f"{agent_id}.jsonl"
        
        if not queue_file.exists():
            return []
        
        messages = []
        with open(queue_file, 'r') as f:
            for line in f:
                if line.strip():
                    msg = json.loads(line)
                    if msg.get("status") == "pending":
                        messages.append(msg)
                        if mark_read:
                            msg["status"] = "read"
        
        return messages
    
    def broadcast(self, from_agent: str, message: dict, filter_criteria: Optional[dict] = None) -> dict:
        """Broadcast a message to all connected agents."""
        recipients = list(self._connected_agents.keys())
        
        if filter_criteria:
            # Filter recipients based on criteria
            recipients = [a for a in recipients if self._matches_criteria(a, filter_criteria)]
        
        results = []
        for agent_id in recipients:
            if agent_id != from_agent:
                result = self.send_message(from_agent, agent_id, message)
                results.append(result)
        
        return {
            "success": True,
            "sent_to": len(results),
            "recipients": recipients
        }
    
    def _matches_criteria(self, agent_id: str, criteria: dict) -> bool:
        """Check if agent matches filter criteria."""
        agent = self._connected_agents.get(agent_id, {})
        agent_config = agent.get("config", {})
        
        for key, value in criteria.items():
            if agent_config.get(key) != value:
                return False
        return True
    
    def coordinate_task(self, task_description: str, involved_agents: List[str]) -> dict:
        """Coordinate a task across multiple agents."""
        task_id = f"task_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hash(task_description) % 10000}"
        
        # Send task initiation to all involved agents
        for agent_id in involved_agents:
            self.send_message(
                "bridge",
                agent_id,
                {
                    "type": "task_coordination",
                    "task_id": task_id,
                    "description": task_description,
                    "role": "participant"
                }
            )
        
        return {
            "success": True,
            "task_id": task_id,
            "agents_notified": len(involved_agents),
            "status": "coordinating"
        }
    
    def discover_agents(self, capabilities: Optional[List[str]] = None) -> List[dict]:
        """Discover agents with specific capabilities."""
        agents = []
        
        if self.agent_registry.exists():
            with open(self.agent_registry, 'r') as f:
                for line in f:
                    if line.strip():
                        agent = json.loads(line)
                        if capabilities:
                            agent_caps = agent.get("config", {}).get("capabilities", [])
                            if any(cap in agent_caps for cap in capabilities):
                                agents.append(agent)
                        else:
                            agents.append(agent)
        
        return agents

# Global instance
_bridge = None

def get_bridge():
    """Get or create singleton instance."""
    global _bridge
    if _bridge is None:
        _bridge = Bridge()
    return _bridge
