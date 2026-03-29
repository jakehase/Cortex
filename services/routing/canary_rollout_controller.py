from __future__ import annotations

import hashlib
from typing import Dict


class CanaryRolloutController:
    def __init__(self, *, rollout_percent: int = 5):
        self.rollout_percent = max(0, min(int(rollout_percent), 100))

    def eligible(self, key: str) -> Dict[str, object]:
        bucket = int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:8], 16) % 100
        enabled = bucket < self.rollout_percent
        return {"enabled": enabled, "bucket": bucket, "rollout_percent": self.rollout_percent}
