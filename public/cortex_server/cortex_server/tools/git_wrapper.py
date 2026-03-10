"""
Git CLI Wrapper - Safe, typed wrapper for Git operations.
"""

import asyncio
import shutil
import tempfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


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
        import subprocess
        
        proc = subprocess.run(
            cmd,
            cwd=cwd or str(self.repo_root),
            capture_output=True,
            text=True,
        )
        
        result = GitResult(
            success=proc.returncode == 0,
            stdout=proc.stdout.strip(),
            stderr=proc.stderr.strip(),
            returncode=proc.returncode,
        )
        
        if check and not result.success:
            raise GitError("Git command failed", " ".join(cmd), str(self.repo_root), result)
        
        return result
    
    async def _run_async(self, *args: str, check: bool = False, cwd: Optional[str] = None) -> GitResult:
        """Run a git command asynchronously."""
        cmd = ["git", *args]
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd or str(self.repo_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        out, err = await proc.communicate()
        
        result = GitResult(
            success=proc.returncode == 0,
            stdout=out.decode().strip(),
            stderr=err.decode().strip(),
            returncode=proc.returncode,
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
        cmd = ["clone", url, path]
        
        if branch:
            cmd.extend(["-b", branch])
        if depth:
            cmd.extend(["--depth", str(depth)])
        
        import subprocess
        proc = subprocess.run(
            ["git", *cmd],
            capture_output=True,
            text=True,
        )
        
        return GitResult(
            success=proc.returncode == 0,
            stdout=proc.stdout.strip(),
            stderr=proc.stderr.strip(),
            returncode=proc.returncode,
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
        cmd = ["git", "clone", url, path]
        
        if branch:
            cmd.extend(["-b", branch])
        if depth:
            cmd.extend(["--depth", str(depth)])
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        out, err = await proc.communicate()
        
        return GitResult(
            success=proc.returncode == 0,
            stdout=out.decode().strip(),
            stderr=err.decode().strip(),
            returncode=proc.returncode,
        )
    
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
    
    def pull(self, remote: str = "origin", branch: Optional[str] = None, rebase: bool = False) -> GitResult:
        """Pull changes from remote."""
        cmd = ["pull", remote]
        if branch:
            cmd.append(branch)
        if rebase:
            cmd.append("--rebase")
        return self._run(*cmd)
    
    async def pull_async(self, remote: str = "origin", branch: Optional[str] = None, rebase: bool = False) -> GitResult:
        """Pull changes from remote asynchronously."""
        cmd = ["pull", remote]
        if branch:
            cmd.append(branch)
        if rebase:
            cmd.append("--rebase")
        return await self._run_async(*cmd)
    
    def commit(self, message: str, files: Optional[List[str]] = None, amend: bool = False) -> GitResult:
        """Create a commit."""
        if files:
            self._run("add", *files, check=True)
        
        cmd = ["commit", "-m", message]
        if amend:
            cmd.append("--amend")
        
        return self._run(*cmd)
    
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
    
    def diff(self, commit_a: str, commit_b: str, file_path: Optional[str] = None) -> GitResult:
        """Get diff between commits."""
        cmd = ["diff", f"{commit_a}..{commit_b}"]
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
        return self._run("branch", name)
    
    def branch_delete(self, name: str, force: bool = False) -> GitResult:
        """Delete a branch."""
        flag = "-D" if force else "-d"
        return self._run("branch", flag, name)
    
    def checkout(self, branch: str, create: bool = False) -> GitResult:
        """Checkout a branch."""
        if create:
            return self._run("checkout", "-b", branch)
        return self._run("checkout", branch)
    
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
        return self._run("fetch", remote)