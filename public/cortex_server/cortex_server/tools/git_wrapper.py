"""
Git CLI Wrapper - Safe, typed wrapper for Git operations.
"""

import asyncio
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
from .subprocess_lifecycle import spawn_owned, stop_process

DEFAULT_TIMEOUT = 60.0
MAX_OUTPUT_CHARS = 1024 * 1024
TERMINATE_GRACE = 1.0
READ_CHUNK_BYTES = 64 * 1024


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
    cmd: List[str], cwd: Optional[str] = None, timeout: float = DEFAULT_TIMEOUT
) -> "GitResult":
    """Run with concurrent fixed-capacity pipe drains and a hard deadline."""
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    tails = [bytearray(), bytearray()]

    def drain(stream: Any, tail: bytearray) -> None:
        while True:
            chunk = stream.read(READ_CHUNK_BYTES)
            if not chunk:
                return
            if len(chunk) >= MAX_OUTPUT_CHARS:
                tail[:] = chunk[-MAX_OUTPUT_CHARS:]
            else:
                overflow = len(tail) + len(chunk) - MAX_OUTPUT_CHARS
                if overflow > 0:
                    del tail[:overflow]
                tail.extend(chunk)

    readers = [threading.Thread(target=drain, args=(stream, tail), daemon=True)
               for stream, tail in zip((proc.stdout, proc.stderr), tails)]
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
    return GitResult(success=proc.returncode == 0,
                     stdout=bytes(tails[0]).decode(errors="replace").strip(),
                     stderr=bytes(tails[1]).decode(errors="replace").strip(),
                     returncode=proc.returncode)


async def _bounded_async_command(proc: Any, timeout: float) -> tuple[bytes, bytes]:
    async def drain(stream: Any) -> bytearray:
        tail = bytearray()
        while True:
            chunk = await stream.read(READ_CHUNK_BYTES)
            if not chunk:
                return tail
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
    return bytes(values[1]), bytes(values[2])


async def _stop_process(proc: Any) -> None:
    """Terminate a child and bound both escalation reap attempts."""
    await stop_process(proc, TERMINATE_GRACE)


async def run_git_async(
    cmd: List[str], cwd: Optional[str] = None, timeout: float = DEFAULT_TIMEOUT
) -> "GitResult":
    """Run Git without blocking, and retain ownership of the child until reaped."""
    proc = await spawn_owned(asyncio.create_subprocess_exec(
        *cmd, cwd=cwd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    ), TERMINATE_GRACE, _stop_process)
    try:
        out, err = await _bounded_async_command(proc, timeout)
    except asyncio.CancelledError:
        await asyncio.shield(_stop_process(proc))
        raise
    except asyncio.TimeoutError:
        await _stop_process(proc)
        raise GitError("Git command timed out")
    except BaseException:
        await asyncio.shield(_stop_process(proc))
        raise
    return GitResult(
        success=proc.returncode == 0,
        stdout=out.decode(errors="replace").strip(),
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
    
    def __init__(self, path: str):
        self.path = Path(path).resolve()
        self.repo_root = self._discover_repo_root(self.path)
    
    def _discover_repo_root(self, path: Path) -> Path:
        """Find the repository root by walking up directories."""
        cur = path
        for _ in range(50):  # Prevent infinite loops
            if (cur / ".git").exists():
                return cur
            if cur.parent == cur:
                break
            cur = cur.parent
        raise GitError("Not a git repository", cwd=str(path))
    
    def _run(self, *args: str, check: bool = False, cwd: Optional[str] = None) -> GitResult:
        """Run a git command."""
        cmd = ["git", *args]
        result = _bounded_sync_command(cmd, cwd or str(self.repo_root))
        
        if check and not result.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), result)
        
        return result
    
    async def _run_async(self, *args: str, check: bool = False, cwd: Optional[str] = None) -> GitResult:
        """Run a git command asynchronously."""
        cmd = ["git", *args]
        
        result = await run_git_async(cmd, cwd or str(self.repo_root), DEFAULT_TIMEOUT)
        
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
        return _bounded_sync_command(["git", *cmd])
    
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
        cmd = ["git", "clone"]
        
        if branch:
            cmd.extend(["-b", _ref(branch, "branch")])
        if depth:
            cmd.extend(["--depth", str(depth)])
        
        cmd.extend(["--", url, path])
        try:
            return await run_git_async(cmd)
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
    
    def status(self) -> Dict[str, List[FileChange]]:
        """Get repository status."""
        res = self._run("status", "--porcelain", check=True)
        
        staged, unstaged, untracked = [], [], []
        
        for line in res.stdout.splitlines():
            if not line:
                continue
            
            code = line[:2]
            filepath = line[3:].strip()
            
            if code == "??":
                untracked.append(FileChange(path=filepath, status="??"))
            else:
                if code[0] != " ":
                    staged.append(FileChange(path=filepath, status=code[0]))
                if code[1] != " ":
                    unstaged.append(FileChange(path=filepath, status=code[1]))
        
        return {"staged": staged, "unstaged": unstaged, "untracked": untracked}

    async def status_async(self) -> Dict[str, List[FileChange]]:
        res = await self._run_async("status", "--porcelain", check=True)
        staged, unstaged, untracked = [], [], []
        for line in res.stdout.splitlines():
            if not line:
                continue
            code, filepath = line[:2], line[3:].strip()
            if code == "??":
                untracked.append(FileChange(path=filepath, status="??"))
            else:
                if code[0] != " ": staged.append(FileChange(path=filepath, status=code[0]))
                if code[1] != " ": unstaged.append(FileChange(path=filepath, status=code[1]))
        return {"staged": staged, "unstaged": unstaged, "untracked": untracked}
    
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
        format_str = "%H|%an|%ad|%s"
        res = await self._run_async("log", f"--max-count={max_count}", "--date=iso",
                                    f"--pretty=format:{format_str}", check=True)
        commits = []
        for line in res.stdout.splitlines():
            parts = line.split("|", 3)
            if len(parts) >= 4:
                h, author, date_str, msg = parts
                try: date = datetime.fromisoformat(date_str.replace(" ", "T"))
                except ValueError: date = datetime.now()
                commits.append(CommitInfo(hash=h, author=author, date=date, message=msg))
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
        return self._run("checkout", "--", _ref(branch, "branch"))
    
    def get_remotes(self) -> List[Dict[str, str]]:
        """Get list of remotes."""
        res = self._run("remote", "-v")
        remotes = []
        
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                remotes.append({"name": parts[0], "url": parts[1]})
        
        return remotes
    
    def fetch(self, remote: str = "origin") -> GitResult:
        """Fetch from remote."""
        return self._run("fetch", "--", _ref(remote, "remote"))
