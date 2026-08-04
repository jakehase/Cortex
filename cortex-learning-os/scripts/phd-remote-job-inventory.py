#!/usr/bin/env python3
"""Report an exact remote qualification job set without remote-shell quoting."""

from __future__ import annotations

import argparse
import grp
import os
from pathlib import Path
import pwd
import re
import stat


SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}[.]json$")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("root", type=Path)
    value.add_argument("view", choices=("files", "metadata"))
    return value


def inventory(root: Path, view: str) -> list[str]:
    if not SAFE_PATH.fullmatch(str(root)):
        raise ValueError("unsafe remote job root")
    root_stat = root.lstat()
    if not stat.S_ISDIR(root_stat.st_mode) or root.is_symlink():
        raise ValueError("remote job root is not a directory")
    entries = sorted(os.scandir(root), key=lambda entry: entry.name)
    if view == "files":
        return [entry.name for entry in entries]

    rows: list[str] = []
    for entry in entries:
        if not SAFE_NAME.fullmatch(entry.name):
            raise ValueError("remote job root contains an unsafe entry name")
        entry_stat = entry.stat(follow_symlinks=False)
        if not stat.S_ISREG(entry_stat.st_mode):
            raise ValueError("remote job root contains a non-regular entry")
        rows.append(
            " ".join(
                (
                    entry.name,
                    pwd.getpwuid(entry_stat.st_uid).pw_name,
                    grp.getgrgid(entry_stat.st_gid).gr_name,
                    f"{stat.S_IMODE(entry_stat.st_mode):o}",
                )
            )
        )
    return rows


def main() -> int:
    args = parser().parse_args()
    for row in inventory(args.root, args.view):
        print(row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
