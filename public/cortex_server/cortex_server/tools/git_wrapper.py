"""
Git CLI Wrapper - Safe, typed wrapper for Git operations.
"""

import asyncio
import os
import shutil
import tempfile
import subprocess
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from .subprocess_lifecycle import spawn_owned, stop_process, wait_for_owned_spawn

DEFAULT_TIMEOUT = 60.0
MAX_OUTPUT_CHARS = 1024 * 1024
TERMINATE_GRACE = 1.0
READ_CHUNK_BYTES = 64 * 1024
OUTPUT_LIMIT_ERROR = "Git command output limit exceeded"


def _close_sync_pipes(proc: Any) -> None:
    for stream in (proc.stdout, proc.stderr):
        try:
            stream.close()
        except BaseException:
            pass


def _reap_sync_process(proc: Any) -> None:
    """Observe a child that outlived the bounded terminate/kill waits."""
    try:
        proc.wait()
    except BaseException:
        pass


def _ref(value: str, kind: str) -> str:
    if not value or value.startswith("-") or "\x00" in value or any(c.isspace() for c in value):
        raise GitError(f"Invalid Git {kind}")
    return value


def _bounded_sync_command(
    cmd: List[str],
    cwd: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    env: Optional[Dict[str, str]] = None,
    strip: bool = True,
) -> "GitResult":
    """Run with concurrent fixed-capacity pipe drains and a hard deadline."""
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    tails = [bytearray(), bytearray()]
    overflowed = [False, False]

    def drain(stream: Any, tail: bytearray, stream_index: int) -> None:
        while True:
            chunk = stream.read(READ_CHUNK_BYTES)
            if not chunk:
                return
            if len(tail) + len(chunk) > MAX_OUTPUT_CHARS:
                overflowed[stream_index] = True
            if len(chunk) >= MAX_OUTPUT_CHARS:
                tail[:] = chunk[-MAX_OUTPUT_CHARS:]
            else:
                overflow = len(tail) + len(chunk) - MAX_OUTPUT_CHARS
                if overflow > 0:
                    del tail[:overflow]
                tail.extend(chunk)

    readers = [threading.Thread(target=drain, args=(stream, tail, index), daemon=True)
               for index, (stream, tail) in enumerate(zip((proc.stdout, proc.stderr), tails))]
    for reader in readers:
        reader.start()
    deadline = time.monotonic() + timeout
    try:
        proc.wait(timeout=max(0.0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=TERMINATE_GRACE)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=TERMINATE_GRACE)
            except subprocess.TimeoutExpired:
                _close_sync_pipes(proc)
                threading.Thread(target=_reap_sync_process, args=(proc,), daemon=True).start()
        _close_sync_pipes(proc)
        for reader in readers:
            reader.join(TERMINATE_GRACE)
        raise GitError("Git command timed out")
    for reader in readers:
        reader.join(max(0.0, deadline - time.monotonic()))
    if any(reader.is_alive() for reader in readers):
        for stream in (proc.stdout, proc.stderr):
            stream.close()
        raise GitError("Git command timed out")
    if any(overflowed):
        raise GitError(OUTPUT_LIMIT_ERROR)
    stdout_text = bytes(tails[0]).decode(errors="replace")
    return GitResult(success=proc.returncode == 0,
                     # Porcelain output is column-sensitive: a leading space is
                     # data, so callers parsing it pass strip=False.
                     stdout=stdout_text.strip() if strip else stdout_text,
                     stderr=bytes(tails[1]).decode(errors="replace").strip(),
                     returncode=proc.returncode)


async def _bounded_async_command(proc: Any, timeout: float) -> tuple[bytes, bytes, bool]:
    async def drain(stream: Any) -> tuple[bytearray, bool]:
        tail = bytearray()
        overflowed = False
        while True:
            chunk = await stream.read(READ_CHUNK_BYTES)
            if not chunk:
                return tail, overflowed
            if len(tail) + len(chunk) > MAX_OUTPUT_CHARS:
                overflowed = True
            if len(chunk) >= MAX_OUTPUT_CHARS:
                tail[:] = chunk[-MAX_OUTPUT_CHARS:]
            else:
                overflow = len(tail) + len(chunk) - MAX_OUTPUT_CHARS
                if overflow > 0:
                    del tail[:overflow]
                tail.extend(chunk)

    tasks = [asyncio.create_task(proc.wait()), asyncio.create_task(drain(proc.stdout)),
             asyncio.create_task(drain(proc.stderr))]
    try:
        values = await asyncio.wait_for(asyncio.gather(*tasks), timeout)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    stdout, stdout_overflowed = values[1]
    stderr, stderr_overflowed = values[2]
    return bytes(stdout), bytes(stderr), stdout_overflowed or stderr_overflowed


async def _stop_process(proc: Any) -> None:
    """Terminate a child and bound both escalation reap attempts."""
    await stop_process(proc, TERMINATE_GRACE)


async def run_git_async(
    cmd: List[str],
    cwd: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    env: Optional[Dict[str, str]] = None,
    strip: bool = True,
) -> "GitResult":
    """Run Git without blocking, and retain ownership of the child until reaped."""
    deadline = asyncio.get_running_loop().time() + timeout
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise GitError("Git command timed out")
    try:
        proc = await wait_for_owned_spawn(spawn_owned(asyncio.create_subprocess_exec(
            *cmd, cwd=cwd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env=env,
        ), TERMINATE_GRACE, _stop_process), remaining, _stop_process)
    except asyncio.TimeoutError:
        raise GitError("Git command timed out")
    try:
        remaining = max(0.0, deadline - asyncio.get_running_loop().time())
        out, err, output_overflowed = await _bounded_async_command(proc, remaining)
    except asyncio.CancelledError:
        await asyncio.shield(_stop_process(proc))
        raise
    except asyncio.TimeoutError:
        await _stop_process(proc)
        raise GitError("Git command timed out")
    except BaseException:
        await asyncio.shield(_stop_process(proc))
        raise
    if output_overflowed:
        raise GitError(OUTPUT_LIMIT_ERROR)
    stdout_text = out.decode(errors="replace")
    return GitResult(
        success=proc.returncode == 0,
        stdout=stdout_text.strip() if strip else stdout_text,
        stderr=err.decode(errors="replace").strip(),
        returncode=proc.returncode,
    )
class GitError(Exception):
    """Exception raised for Git errors."""
    
    def __init__(self, message: str, command: str = "", cwd: str = "", result: Optional["GitResult"] = None):
        super().__init__(message)
        self.command = command
        self.cwd = cwd
        self.result = result
    
    def __str__(self):
        base = super().__str__()
        if self.result:
            return f"{base} (cmd={self.command}, rc={self.result.returncode}, stderr={self.result.stderr})"
        return f"{base} (cmd={self.command}, cwd={self.cwd})"


class GitResult(BaseModel):
    """Result of a Git command."""
    success: bool
    stdout: str
    stderr: str
    returncode: int


class FileChange(BaseModel):
    """File change information."""
    path: str
    additions: int = 0
    deletions: int = 0
    status: str = Field(..., description="Git status code: M, A, D, R, ??, etc.")
    original_path: Optional[str] = None


def parse_porcelain_z(output: str) -> Dict[str, List[FileChange]]:
    """Parse ``git status --porcelain=v1 -z`` exactly (no whitespace stripping).

    Entries are ``XY<space>PATH`` separated by NUL; renames/copies are followed
    by a second NUL-terminated field holding the original path.
    """
    staged: List[FileChange] = []
    unstaged: List[FileChange] = []
    untracked: List[FileChange] = []
    fields = output.split("\0")
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if not entry:
            continue
        if len(entry) < 4 or entry[2] != " ":
            raise GitError("Unexpected git status record")
        x, y, path = entry[0], entry[1], entry[3:]
        original = None
        if x in "RC" or y in "RC":
            original = fields[index] if index < len(fields) else None
            index += 1
        if x == "?" and y == "?":
            untracked.append(FileChange(path=path, status="??"))
            continue
        if x == "!" and y == "!":
            continue
        if x != " ":
            staged.append(FileChange(path=path, status=x, original_path=original))
        if y != " ":
            unstaged.append(FileChange(path=path, status=y, original_path=original if x == " " else None))
    return {"staged": staged, "unstaged": unstaged, "untracked": untracked}


def _within(candidate: Path, root: Path) -> bool:
    return candidate == root or root in candidate.parents


class CommitInfo(BaseModel):
    """Commit information."""
    hash: str
    author: str
    date: datetime
    message: str
    files_changed: List[FileChange] = Field(default_factory=list)


class BranchInfo(BaseModel):
    """Branch information."""
    name: str
    is_current: bool = False
    remote_tracking: Optional[str] = None


class GitRepo:
    """Git repository interface."""
    
    def __init__(self, path: str, *, boundary: Optional[str] = None):
        self.path = Path(path).resolve()
        self.boundary = self._discovery_boundary(self.path, boundary)
        self.repo_root = self._discover_repo_root(self.path)

    @staticmethod
    def _command(*args: str) -> List[str]:
        return [
            "git",
            "-c", "core.hooksPath=/dev/null",
            "-c", "core.fsmonitor=false",
            "-c", "credential.helper=",
            "-c", "core.pager=cat",
            "-c", "commit.gpgSign=false",
            "-c", "tag.gpgSign=false",
            "-c", "diff.external=",
            *args,
        ]

    @staticmethod
    def _environment() -> Dict[str, str]:
        return {
            "PATH": os.getenv("PATH", "/usr/bin:/bin"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "HOME": "/nonexistent",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "/bin/false",
        }
    
    @staticmethod
    def _discovery_boundary(path: Path, boundary: Optional[str]) -> Path:
        """Highest directory repository discovery may reach.

        An explicit boundary wins; otherwise the deepest configured execution
        root containing ``path``; otherwise ``path`` itself (no upward walk).
        This prevents a request for ``<root>/sub`` from silently operating on a
        parent repository that lives outside the authorized root.
        """
        if boundary is not None:
            limit = Path(boundary).resolve()
            if not _within(path, limit):
                raise GitError("Repository path is outside the authorized root", cwd=str(path))
            return limit
        try:
            from cortex_server.modules.execution_capabilities import configured_roots

            roots = [root for root in configured_roots() if _within(path, root)]
        except Exception:
            roots = []
        if roots:
            return max(roots, key=lambda root: len(root.parts))
        return path

    def _discover_repo_root(self, path: Path) -> Path:
        """Find the repository root without leaving the discovery boundary."""
        limit = getattr(self, "boundary", path)
        cur = path
        for _ in range(50):  # Prevent infinite loops
            dot_git = cur / ".git"
            if dot_git.exists():
                target = dot_git.resolve()
                if dot_git.is_file():
                    try:
                        line = dot_git.read_text(encoding="utf-8", errors="replace").strip()
                    except OSError as exc:
                        raise GitError("Unreadable git metadata", cwd=str(cur)) from exc
                    if line.startswith("gitdir:"):
                        target = (cur / line[len("gitdir:"):].strip()).resolve()
                if not _within(target, limit):
                    raise GitError("Repository metadata is outside the authorized root", cwd=str(path))
                return cur
            if cur == limit or cur.parent == cur:
                break
            cur = cur.parent
        raise GitError("Not a git repository within the authorized root", cwd=str(path))
    
    def _run(self, *args: str, check: bool = False, cwd: Optional[str] = None, strip: bool = True) -> GitResult:
        """Run a git command."""
        cmd = self._command(*args)
        if strip:
            result = _bounded_sync_command(
                cmd,
                cwd or str(self.repo_root),
                env=self._environment(),
            )
        else:
            result = _bounded_sync_command(
                cmd,
                cwd or str(self.repo_root),
                env=self._environment(),
                strip=False,
            )
        
        if check and not result.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), result)
        
        return result
    
    async def _run_async(self, *args: str, check: bool = False, cwd: Optional[str] = None, strip: bool = True) -> GitResult:
        """Run a git command asynchronously."""
        cmd = self._command(*args)
        
        if strip:
            result = await run_git_async(
                cmd,
                cwd or str(self.repo_root),
                DEFAULT_TIMEOUT,
                env=self._environment(),
            )
        else:
            result = await run_git_async(
                cmd,
                cwd or str(self.repo_root),
                DEFAULT_TIMEOUT,
                env=self._environment(),
                strip=False,
            )
        
        if check and not result.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), result)
        
        return result
    
    @staticmethod
    def clone(
        url: str,
        path: str,
        *,
        branch: Optional[str] = None,
        depth: Optional[int] = None,
    ) -> GitResult:
        """Clone a repository."""
        _ref(url, "URL")
        cmd = ["clone"]
        
        if branch:
            cmd.extend(["-b", _ref(branch, "branch")])
        if depth:
            cmd.extend(["--depth", str(depth)])
        cmd.extend(["--", url, path])
        return _bounded_sync_command(
            GitRepo._command(*cmd),
            env=GitRepo._environment(),
        )

    @staticmethod
    def init(path: str) -> GitResult:
        """Initialize a repository with the restricted Git environment."""
        return _bounded_sync_command(
            GitRepo._command("init", "--", path),
            env=GitRepo._environment(),
        )
    
    @staticmethod
    async def clone_async(
        url: str,
        path: str,
        *,
        branch: Optional[str] = None,
        depth: Optional[int] = None,
    ) -> GitResult:
        """Clone a repository asynchronously."""
        _ref(url, "URL")
        clone_args = ["clone"]
        
        if branch:
            clone_args.extend(["-b", _ref(branch, "branch")])
        if depth:
            clone_args.extend(["--depth", str(depth)])
        clone_args.extend(["--", url, path])
        cmd = GitRepo._command(*clone_args)
        try:
            return await run_git_async(cmd, env=GitRepo._environment())
        except GitError as exc:
            if str(exc).startswith("Git command timed out"):
                raise GitError("Git clone timed out") from exc
            raise
    
    @staticmethod
    @asynccontextmanager
    async def temp_clone(url: str, branch: Optional[str] = None, depth: Optional[int] = None):
        """Context manager for temporary repository clone."""
        tmpdir = Path(tempfile.mkdtemp(prefix="gitrepo_"))
        try:
            result = await GitRepo.clone_async(url, str(tmpdir), branch=branch, depth=depth)
            if not result.success:
                raise GitError(f"Clone failed: {result.stderr}")
            yield GitRepo(tmpdir)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
    
    def _read_only_environment(self) -> Dict[str, str]:
        # GIT_OPTIONAL_LOCKS=0 stops `git status` from opportunistically
        # rewriting .git/index, so inspection really is read-only.
        return {**self._environment(), "GIT_OPTIONAL_LOCKS": "0"}

    def status(self) -> Dict[str, List[FileChange]]:
        """Get repository status (byte-exact porcelain v1 -z parsing, no index refresh)."""
        cmd = self._command("status", "--porcelain=v1", "-z")
        res = _bounded_sync_command(cmd, str(self.repo_root), env=self._read_only_environment(), strip=False)
        if not res.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), res)
        return parse_porcelain_z(res.stdout)

    async def status_async(self) -> Dict[str, List[FileChange]]:
        cmd = self._command("status", "--porcelain=v1", "-z")
        res = await run_git_async(cmd, str(self.repo_root), DEFAULT_TIMEOUT,
                                  env=self._read_only_environment(), strip=False)
        if not res.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), res)
        return parse_porcelain_z(res.stdout)

    async def head_async(self) -> Optional[str]:
        """Current HEAD commit sha, or None for a repository with no commits."""
        res = await self._run_async("rev-parse", "--verify", "--quiet", "HEAD")
        value = res.stdout.strip()
        return value if res.success and len(value) in (40, 64) else None

    def pull(self, remote: str = "origin", branch: Optional[str] = None, rebase: bool = False) -> GitResult:
        """Pull changes from remote."""
        cmd = ["pull"]
        if rebase:
            cmd.append("--rebase")
        cmd.extend(["--", _ref(remote, "remote")])
        if branch:
            cmd.append(_ref(branch, "branch"))
        return self._run(*cmd)
    
    async def pull_async(self, remote: str = "origin", branch: Optional[str] = None, rebase: bool = False) -> GitResult:
        """Pull changes from remote asynchronously."""
        cmd = ["pull"]
        if rebase:
            cmd.append("--rebase")
        cmd.extend(["--", _ref(remote, "remote")])
        if branch:
            cmd.append(_ref(branch, "branch"))
        return await self._run_async(*cmd)
    
    def commit(self, message: str, files: Optional[List[str]] = None, amend: bool = False) -> GitResult:
        """Create a commit."""
        if files:
            self._run("add", "--", *files, check=True)
        
        cmd = ["commit", "-m", message]
        if amend:
            cmd.append("--amend")
        
        return self._run(*cmd)

    async def commit_async(self, message: str) -> GitResult:
        return await self._run_async("commit", "-m", message)
    
    def log(
        self,
        max_count: int = 10,
        file_path: Optional[str] = None,
        since: Optional[str] = None,
    ) -> List[CommitInfo]:
        """Get commit history."""
        format_str = "%H|%an|%ad|%s"
        cmd = ["log", f"--max-count={max_count}", "--date=iso", f"--pretty=format:{format_str}"]
        
        if since:
            cmd.append(f"--since={since}")
        if file_path:
            cmd.extend(["--", file_path])
        
        res = self._run(*cmd, check=True)
        commits = []
        
        for line in res.stdout.splitlines():
            parts = line.split("|", 3)
            if len(parts) >= 4:
                h, author, date_str, msg = parts
                try:
                    date = datetime.fromisoformat(date_str.replace(" ", "T"))
                except:
                    date = datetime.now()
                commits.append(CommitInfo(hash=h, author=author, date=date, message=msg))
        
        return commits

    async def log_async(self, max_count: int = 10) -> List[CommitInfo]:
        """Commit log with unambiguous separators; undated rows are skipped, never invented."""
        max_count = max(1, min(int(max_count), 200))
        res = await self._run_async("log", f"--max-count={max_count}",
                                    "--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1e", check=True)
        commits = []
        for record in res.stdout.split("\x1e"):
            parts = record.strip("\n").split("\x1f")
            if len(parts) != 4:
                continue
            h, author, date_str, msg = parts
            try:
                date = datetime.fromisoformat(date_str.strip())
            except ValueError:
                continue
            commits.append(CommitInfo(hash=h.strip(), author=author, date=date, message=msg))
        return commits
    
    def diff(self, commit_a: str, commit_b: str, file_path: Optional[str] = None) -> GitResult:
        """Get diff between commits."""
        cmd = ["diff", f"{_ref(commit_a, 'revision')}..{_ref(commit_b, 'revision')}"]
        if file_path:
            cmd.extend(["--", file_path])
        return self._run(*cmd)
    
    def branch_list(self) -> List[BranchInfo]:
        """List branches."""
        res = self._run("branch", "-vv", check=True)
        branches = []
        
        for line in res.stdout.splitlines():
            is_current = line.startswith("*")
            parts = line[2:].split()
            
            if not parts:
                continue
            
            name = parts[0]
            remote_tracking = None
            
            if len(parts) > 1 and parts[1].startswith("["):
                remote_tracking = parts[1].strip("[]")
            
            branches.append(BranchInfo(
                name=name,
                is_current=is_current,
                remote_tracking=remote_tracking
            ))
        
        return branches
    
    def branch_create(self, name: str) -> GitResult:
        """Create a new branch."""
        return self._run("branch", "--", _ref(name, "branch"))
    
    def branch_delete(self, name: str, force: bool = False) -> GitResult:
        """Delete a branch."""
        flag = "-D" if force else "-d"
        return self._run("branch", flag, "--", _ref(name, "branch"))
    
    def checkout(self, branch: str, create: bool = False) -> GitResult:
        """Checkout a branch."""
        if create:
            return self._run("checkout", "-b", _ref(branch, "branch"))
        return self._run("checkout", _ref(branch, "branch"))
    
    def get_remotes(self) -> List[Dict[str, str]]:
        """Get list of remotes."""
        res = self._run("remote", "-v")
        remotes = []
        
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                remotes.append({"name": parts[0], "url": parts[1]})
        
        return remotes

    def remote_url(self, remote: str) -> str:
        """Resolve a configured remote without invoking credential helpers."""
        result = self._run("remote", "get-url", "--", _ref(remote, "remote"), check=True)
        return result.stdout.strip()

    async def remote_url_async(self, remote: str) -> str:
        """Resolve a configured remote without blocking the event loop."""
        result = await self._run_async(
            "remote", "get-url", "--", _ref(remote, "remote"), check=True
        )
        return result.stdout.strip()
    
    def fetch(self, remote: str = "origin") -> GitResult:
        """Fetch from remote."""
        return self._run("fetch", "--", _ref(remote, "remote"))
