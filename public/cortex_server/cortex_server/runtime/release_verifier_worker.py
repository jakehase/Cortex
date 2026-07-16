"""Least-privilege independent release evidence worker."""

import os

from cortex_server.runtime.handoff_consumer import main


if __name__ == "__main__":
    os.environ.setdefault("CORTEX_RELEASE_CONTROLLER_ROLE", "verifier")
    main()
