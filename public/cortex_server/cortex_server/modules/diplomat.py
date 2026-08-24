"""The Diplomat - Autonomous Communication Module for The Cortex.

Level 18: Proactive WhatsApp messaging and human authorization.
Enables the system to initiate conversations and request permissions.
"""
import os
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict
import requests


class TheDiplomat:
    """Diplomatic envoy for external communication.
    
    Capabilities:
    1. send_briefing() - Send formatted updates to WhatsApp
    2. ask_permission() - Request human authorization for actions
    
    All messages are formatted for clarity and professionalism.
    """
    
    def __init__(self, 
                 gateway_url: str = "http://localhost:8080",
                 owner_number: str = "+17855410986"):
        self.gateway_url = gateway_url
        self.owner_number = owner_number
        self.pending_requests: Dict[str, Dict] = {}
        self.message_log = Path("cortex_server/knowledge/evolution/diplomat_log.txt")
        self.pending_requests_file = Path("cortex_server/knowledge/evolution/pending_requests.json")
        
    def send_briefing(self, message: str, title: str = "🧠 Cortex Update") -> bool:
        """Send a formatted briefing message to WhatsApp.
        
        Args:
            message: The main content
            title: Header for the message
            
        Returns:
            True if sent successfully
        """
        try:
            # Format the message with emojis and structure
            timestamp = datetime.now().strftime("%H:%M")
            formatted_message = f"""{title}
═══════════════════
⏰ {timestamp}

{message}

◈ The Cortex ◈"""
            
            # Try to send via OpenClaw gateway
            success = self._send_to_whatsapp(formatted_message)
            
            # Log the attempt
            self._log_message("BRIEFING", formatted_message, success)
            
            return success
            
        except Exception as e:
            self._log_message("BRIEFING_ERROR", str(e), False)
            return False
    
    def ask_permission(self, request: str, request_id: Optional[str] = None, 
                       timeout_seconds: int = 300) -> bool:
        """Request human authorization for an action.
        
        Args:
            request: Description of what needs approval
            request_id: Unique ID for tracking (auto-generated if None)
            timeout_seconds: How long to wait for response
            
        Returns:
            True if approved, False if denied or timeout
        """
        if request_id is None:
            request_id = f"req_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            # Format the authorization request
            timestamp = datetime.now().strftime("%H:%M")
            formatted_request = f"""⚠️ AUTHORIZATION REQUIRED
═══════════════════
⏰ {timestamp}
🔐 Request ID: {request_id}

{request}

Reply with:
✅ YES - to approve
❌ NO - to deny

⏳ Timeout: {timeout_seconds} seconds

◈ The Cortex ◈"""
            
            # Send the request
            success = self._send_to_whatsapp(formatted_request)
            
            if success:
                # Store pending request
                self.pending_requests[request_id] = {
                    'request': request,
                    'status': 'pending',
                    'sent_at': datetime.now().isoformat(),
                    'timeout_at': (datetime.now().timestamp() + timeout_seconds)
                }
                self._save_pending_requests()
                
                self._log_message("PERMISSION_ASKED", f"{request_id}: {request}", True)
                
                # Wait for response (blocking call)
                return self._wait_for_response(request_id, timeout_seconds)
            else:
                self._log_message("PERMISSION_FAILED", request, False)
                return False
                
        except Exception as e:
            self._log_message("PERMISSION_ERROR", str(e), False)
            return False
    
    def process_response(self, request_id: str, response: str) -> bool:
        """Process an inbound response to a permission request.
        
        Called by the webhook handler when user replies.
        
        Args:
            request_id: The request ID
            response: User's response text (YES/NO)
            
        Returns:
            True if processed successfully
        """
        if request_id not in self.pending_requests:
            return False
        
        response_upper = response.strip().upper()
        
        if 'YES' in response_upper:
            self.pending_requests[request_id]['status'] = 'approved'
            self._save_pending_requests()
            self._log_message("PERMISSION_GRANTED", request_id, True)
            return True
        elif 'NO' in response_upper:
            self.pending_requests[request_id]['status'] = 'denied'
            self._save_pending_requests()
            self._log_message("PERMISSION_DENIED", request_id, True)
            return True
        else:
            return False
    
    def _send_to_whatsapp(self, message: str) -> bool:
        """Send message via OpenClaw gateway or internal routing."""
        try:
            # Method 1: Try OpenClaw gateway API
            payload = {
                "target": self.owner_number,
                "message": message,
                "channel": "whatsapp"
            }
            
            # Try the local gateway endpoint
            try:
                resp = requests.post(
                    f"{self.gateway_url}/message/send",
                    json=payload,
                    timeout=10
                )
                if resp.status_code == 200:
                    return True
            except:
                pass
            
            # Method 2: Write to message queue file (for OpenClaw to poll)
            queue_file = Path("/tmp/cortex_outbox/whatsapp.jsonl")
            queue_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(queue_file, 'a') as f:
                json.dump({
                    "timestamp": datetime.now().isoformat(),
                    "target": self.owner_number,
                    "message": message,
                    "channel": "whatsapp"
                }, f)
                f.write('\n')
            
            return True
            
        except Exception as e:
            print(f"[DIPLOMAT] Send failed: {e}")
            return False
    
    def _wait_for_response(self, request_id: str, timeout_seconds: int) -> bool:
        """Wait for human response to permission request."""
        start_time = time.time()
        
        while time.time() - start_time < timeout_seconds:
            # Reload pending requests (in case updated by webhook)
            self._load_pending_requests()
            
            if request_id in self.pending_requests:
                status = self.pending_requests[request_id].get('status')
                
                if status == 'approved':
                    return True
                elif status == 'denied':
                    return False
            
            # Wait a bit before checking again
            time.sleep(5)
        
        # Timeout - default to denied for safety
        self.pending_requests[request_id]['status'] = 'timeout'
        self._save_pending_requests()
        self._log_message("PERMISSION_TIMEOUT", request_id, False)
        return False
    
    def _save_pending_requests(self):
        """Save pending requests to disk."""
        self.pending_requests_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.pending_requests_file, 'w') as f:
            json.dump(self.pending_requests, f, indent=2)
    
    def _load_pending_requests(self):
        """Load pending requests from disk."""
        if self.pending_requests_file.exists():
            try:
                with open(self.pending_requests_file, 'r') as f:
                    self.pending_requests = json.load(f)
            except:
                self.pending_requests = {}
    
    def _log_message(self, msg_type: str, content: str, success: bool):
        """Log diplomat activity."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        status = "✓" if success else "✗"
        log_line = f"[{timestamp}] [{status}] {msg_type}: {content[:100]}...\n"
        
        self.message_log.parent.mkdir(parents=True, exist_ok=True)
        with open(self.message_log, 'a') as f:
            f.write(log_line)
        
        print(f"[DIPLOMAT] {msg_type}: {content[:80]}...")


# Singleton instance
_diplomat_instance = None


def get_diplomat() -> TheDiplomat:
    """Get or create The Diplomat singleton."""
    global _diplomat_instance
    if _diplomat_instance is None:
        _diplomat_instance = TheDiplomat()
    return _diplomat_instance
