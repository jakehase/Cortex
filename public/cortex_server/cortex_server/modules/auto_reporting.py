"""Auto-Reporting System - All levels report to L32 Synthesist

This is the CANONICAL reporting module. Any level that needs to report
activity to Synthesist should import from here.

NOTE: synthesist.py contains a duplicate `report_to_synthesist` function
and a `SynthesistReportingMixin` class that should be removed in favor
of importing from this module. (Another agent is handling that cleanup.)
"""

import functools
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


def report_activity(level_name: str, activity_type: str, data: dict):
    """Report activity to Synthesist (core implementation).

    This is the single canonical path for sending reports to L32.
    Fails silently so it never breaks the calling level's functionality.
    """
    try:
        # Import here to avoid circular imports
        from .synthesist import get_synthesist
        synthesist = get_synthesist()
        synthesist.ingest_from_level(level_name, {
            "activity_type": activity_type,
            "timestamp": datetime.now().isoformat(),
            "data": data
        })
    except Exception:
        # Fail silently — don't break functionality if reporting fails
        pass


def report_to_synthesist(level_name: str, activity_type: str, data: dict):
    """Public API for any level to report to Synthesist.

    This is the function other modules should import:
        from modules.auto_reporting import report_to_synthesist
    """
    report_activity(level_name, activity_type, data)


def auto_report(level_name: str, activity_type: str):
    """Decorator to auto-report method calls to Synthesist.

    Usage:
        @auto_report("librarian", "search")
        def search(self, query):
            ...
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)

            try:
                report_activity(level_name, activity_type, {
                    "method": func.__name__,
                    "result_type": type(result).__name__,
                    "timestamp": datetime.now().isoformat()
                })
            except Exception:
                pass

            return result

        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            result = await func(*args, **kwargs)

            try:
                report_activity(level_name, activity_type, {
                    "method": func.__name__,
                    "result_type": type(result).__name__,
                    "timestamp": datetime.now().isoformat()
                })
            except Exception:
                pass

            return result

        # Return the right wrapper based on whether the function is async
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper
    return decorator


class AutoReportingMixin:
    """Mixin for any level class to get auto-reporting to Synthesist.

    Expects the class to have a `name` attribute (str).

    Usage:
        class MyLevel(AutoReportingMixin):
            name = "MyLevel"
            ...
            def do_thing(self):
                self.report_activity("did_thing", {"detail": "value"})
    """

    def report_activity(self, activity_type: str, data: dict):
        """Report activity to Synthesist using this level's name."""
        level_name = getattr(self, "name", self.__class__.__name__).lower()
        report_to_synthesist(level_name, activity_type, data)

    def report_status(self):
        """Report current status if a status() method exists."""
        if hasattr(self, "status") and callable(self.status):
            self.report_activity("status_update", self.status())
