"""
FFmpeg CLI Wrapper - Safe, typed interface to FFmpeg.
"""

import asyncio
import json
import re
from typing import Dict, List, Optional, Callable, Any
from pathlib import Path
from pydantic import BaseModel, Field, field_validator

from .subprocess_lifecycle import spawn_owned, stop_process


class FFmpegError(Exception):
    """FFmpeg execution error."""
    def __init__(self, message: str, stderr: str = "", exit_code: Optional[int] = None):
        super().__init__(message)
        self.stderr = stderr
        self.exit_code = exit_code


class FFmpegInput(BaseModel):
    """FFmpeg input configuration."""
    path: str
    start_time: Optional[float] = Field(default=None, ge=0)
    duration: Optional[float] = Field(default=None, gt=0)
    codec_options: Dict[str, str] = Field(default_factory=dict)


class FFmpegOutput(BaseModel):
    """FFmpeg output configuration."""
    path: str
    format: Optional[str] = None
    codec: Optional[str] = None
    quality: Optional[int] = Field(default=None, ge=0, le=51)  # CRF range
    codec_options: Dict[str, str] = Field(default_factory=dict)


class FFmpegJob(BaseModel):
    """Complete FFmpeg job specification."""
    input: FFmpegInput
    output: FFmpegOutput
    operation: str = "convert"  # convert, extract_audio, create_thumbnail
    timeout: Optional[float] = Field(default=None, gt=0)


# Regex patterns for parsing progress
TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")
SPEED_RE = re.compile(r"speed=([\d\.]+)x")
PROGRESS_RE = re.compile(r"size=\s*(\d+)kB")
DEFAULT_TIMEOUT = 300.0
MAX_OUTPUT_CHARS = 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024
MAX_PROGRESS_LINE_BYTES = 64 * 1024
CLEANUP_REAP_GRACE = 1.0
SPAWN_CANCEL_GRACE = 0.05


async def _bounded_drain(stream: Any) -> bytearray:
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


def _append_bounded(buffer: bytearray, chunk: bytes, limit: int) -> None:
    if len(chunk) >= limit:
        buffer[:] = chunk[-limit:]
        return
    overflow = len(buffer) + len(chunk) - limit
    if overflow > 0:
        del buffer[:overflow]
    buffer.extend(chunk)


async def _stop_process(proc: Any) -> None:
    """Terminate, escalate, and reap within finite grace periods."""
    await stop_process(proc, CLEANUP_REAP_GRACE)


def _close_process_transports(proc: Any) -> None:
    """Close subprocess pipes/transport without depending on their public shape."""
    for stream_name in ("stdout", "stderr", "stdin"):
        stream = getattr(proc, stream_name, None)
        transport = getattr(stream, "_transport", None)
        if transport is not None:
            try:
                transport.close()
            except BaseException:
                pass
    transport = getattr(proc, "_transport", None)
    if transport is not None:
        try:
            transport.close()
        except BaseException:
            pass


async def _settle_tasks(tasks: List[asyncio.Task[Any]], deadline: float) -> None:
    """Cancel and observe tasks, never waiting beyond the operation deadline."""
    for task in tasks:
        if not task.done():
            task.cancel()
    if not tasks:
        return
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining > 0:
        try:
            await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True), remaining
            )
        except asyncio.TimeoutError:
            pass
    # A cancelled stream read normally settles on the next loop turn. Observe
    # it even when the deadline has just elapsed, without extending the budget.
    await asyncio.sleep(0)


async def _stop_at_deadline(proc: Any) -> None:
    """Best-effort stop/reap with a separate, finite cleanup budget."""
    await stop_process(proc, CLEANUP_REAP_GRACE)


async def _spawn_owned(*args: str, **kwargs: Any) -> Any:
    """Spawn a child without allowing cancellation to orphan it mid-creation."""
    return await spawn_owned(
        asyncio.create_subprocess_exec(*args, **kwargs),
        SPAWN_CANCEL_GRACE,
        _stop_process,
    )


async def _spawn_before(deadline: float, *args: str, **kwargs: Any) -> Any:
    """Spawn within a deadline while retaining ownership on cancellation."""
    return await asyncio.wait_for(
        _spawn_owned(*args, **kwargs),
        max(0.0, deadline - asyncio.get_running_loop().time()),
    )


class FFmpegWrapper:
    """Async FFmpeg wrapper with progress callbacks."""
    
    def __init__(self, ffmpeg_bin: str = "ffmpeg", ffprobe_bin: str = "ffprobe"):
        self.ffmpeg_bin = ffmpeg_bin
        self.ffprobe_bin = ffprobe_bin
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc, tb):
        return False
    
    async def run(
        self,
        args: List[str],
        *,
        timeout: Optional[float] = None,
        total_time: Optional[float] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> str:
        """
        Run ffmpeg with given args.
        
        Args:
            args: Command line arguments (including 'ffmpeg')
            timeout: Maximum execution time in seconds
            total_time: Expected total duration for progress calculation
            on_progress: Callback(current_time, total_time, speed)
        
        Returns:
            stderr output on success
        
        Raises:
            FFmpegError on failure or timeout
        """
        timeout_seconds = timeout or DEFAULT_TIMEOUT
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds
        proc = None
        stdout_task: Optional[asyncio.Task[Any]] = None
        stderr_task: Optional[asyncio.Task[Any]] = None

        try:
            proc = await _spawn_before(
                deadline,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except asyncio.TimeoutError:
            raise FFmpegError(f"ffmpeg timed out after {timeout_seconds}s")
        
        stderr_tail = bytearray()

        async def read_stderr() -> None:
            progress_buffer = bytearray()

            def parse_progress(record: bytes) -> None:
                if not on_progress:
                    return
                text = record.decode(errors="replace")
                current_time = self._parse_time(text)
                speed = self._parse_speed(text)
                if current_time is not None and speed is not None:
                    on_progress(current_time, total_time or 0.0, speed)

            while True:
                chunk = await proc.stderr.read(READ_CHUNK_BYTES)
                if not chunk:
                    break
                _append_bounded(stderr_tail, chunk, MAX_OUTPUT_CHARS)

                # ffmpeg commonly refreshes progress with CR, though LF is also
                # used. Keep partial records independently bounded so an
                # untrusted newline-free record cannot grow without limit.
                start = 0
                for index, byte in enumerate(chunk):
                    if byte not in (10, 13):
                        continue
                    _append_bounded(progress_buffer, chunk[start:index], MAX_PROGRESS_LINE_BYTES)
                    parse_progress(progress_buffer)
                    progress_buffer.clear()
                    start = index + 1
                _append_bounded(progress_buffer, chunk[start:], MAX_PROGRESS_LINE_BYTES)

            if progress_buffer:
                parse_progress(progress_buffer)
        
        stdout_task = asyncio.create_task(_bounded_drain(proc.stdout))
        stderr_task = asyncio.create_task(read_stderr())
        drain_tasks = [stdout_task, stderr_task]
        
        try:
            await asyncio.wait_for(proc.wait(), max(0.0, deadline - loop.time()))
            await asyncio.wait_for(
                asyncio.gather(*drain_tasks), max(0.0, deadline - loop.time())
            )
        except asyncio.TimeoutError:
            await _settle_tasks(drain_tasks, deadline)
            # The direct child may already be reaped while a descendant still
            # owns a pipe. Otherwise stop it, but do not let cleanup become a
            # second, unbounded timeout window.
            if proc.returncode is None and deadline > loop.time():
                try:
                    await asyncio.wait_for(
                        _stop_process(proc), max(0.0, deadline - loop.time())
                    )
                except asyncio.TimeoutError:
                    await _stop_at_deadline(proc)
            else:
                await _stop_at_deadline(proc)
            raise FFmpegError(
                f"ffmpeg timed out after {timeout_seconds}s",
                stderr_tail.decode(errors="replace"),
            )
        except asyncio.CancelledError:
            try:
                await _stop_process(proc)
            except BaseException:
                _close_process_transports(proc)
            await _settle_tasks(drain_tasks, deadline)
            raise
        except Exception:
            # A drain can fail independently (including in a progress
            # callback). Retain ownership of the subprocess and both pipe
            # tasks before propagating the original failure.
            try:
                await _stop_process(proc)
            except BaseException:
                _close_process_transports(proc)
            await _settle_tasks(drain_tasks, deadline)
            raise
        
        if proc.returncode != 0:
            raise FFmpegError(
                f"ffmpeg failed with exit code {proc.returncode}",
                stderr_tail.decode(errors="replace"),
                proc.returncode,
            )
        
        return stderr_tail.decode(errors="replace")
    
    def build_convert_args(self, job: FFmpegJob) -> List[str]:
        """Build ffmpeg arguments for convert operation."""
        inp = job.input
        out = job.output
        
        args = [self.ffmpeg_bin, "-y"]
        
        if inp.start_time is not None:
            args += ["-ss", str(inp.start_time)]
        if inp.duration is not None:
            args += ["-t", str(inp.duration)]
        
        args += ["-i", inp.path]
        
        # Input codec options
        for k, v in inp.codec_options.items():
            args += [f"-{k}", v]
        
        # Output options
        if out.codec:
            args += ["-c:v", out.codec]
        if out.quality is not None:
            args += ["-crf", str(out.quality)]
        if out.format:
            args += ["-f", out.format]
        
        for k, v in out.codec_options.items():
            args += [f"-{k}", v]
        
        args.append(out.path)
        return args
    
    async def convert(
        self,
        input_path: str,
        output_path: str,
        codec: Optional[str] = None,
        quality: Optional[int] = None,
        start_time: Optional[float] = None,
        duration: Optional[float] = None,
        timeout: Optional[float] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> str:
        """Convert media file."""
        job = FFmpegJob(
            input=FFmpegInput(path=input_path, start_time=start_time, duration=duration),
            output=FFmpegOutput(path=output_path, codec=codec, quality=quality),
            operation="convert",
            timeout=timeout,
        )
        
        args = self.build_convert_args(job)
        
        # Get duration for progress if not provided
        total_time = duration
        if total_time is None:
            try:
                info = await self.get_info(input_path)
                total_time = info.get("format", {}).get("duration")
                if total_time:
                    total_time = float(total_time)
            except:
                pass
        
        return await self.run(
            args,
            timeout=timeout,
            total_time=total_time,
            on_progress=on_progress,
        )
    
    async def extract_audio(
        self,
        input_path: str,
        output_path: str,
        format: str = "mp3",
        timeout: Optional[float] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> str:
        """Extract audio from video."""
        job = FFmpegJob(
            input=FFmpegInput(path=input_path),
            output=FFmpegOutput(
                path=output_path,
                format=format,
                codec="libmp3lame" if format == "mp3" else None,
            ),
            operation="extract_audio",
            timeout=timeout,
        )
        
        args = self.build_convert_args(job)
        output = args.pop()
        args += ["-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k", output]
        
        # Get duration for progress
        total_time = None
        try:
            info = await self.get_info(input_path)
            total_time = info.get("format", {}).get("duration")
            if total_time:
                total_time = float(total_time)
        except:
            pass
        
        return await self.run(
            args,
            timeout=timeout,
            total_time=total_time,
            on_progress=on_progress,
        )
    
    async def create_thumbnail(
        self,
        input_path: str,
        output_path: str,
        time: float = 0.5,
        width: Optional[int] = None,
        timeout: Optional[float] = None,
    ) -> str:
        """Create thumbnail image from video."""
        args = [
            self.ffmpeg_bin,
            "-y",
            "-ss", str(time),
            "-i", input_path,
            "-vframes", "1",
        ]
        
        if width:
            args += ["-vf", f"scale={width}:-1"]
        
        args += ["-f", "image2", output_path]
        
        return await self.run(args, timeout=timeout)
    
    async def get_info(self, input_path: str, timeout: Optional[float] = None) -> Dict[str, Any]:
        """Get media file information using ffprobe."""
        timeout_seconds = timeout or DEFAULT_TIMEOUT
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds
        args = [
            self.ffprobe_bin,
            "-v", "error",
            "-show_entries", "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height",
            "-of", "json",
            input_path,
        ]
        
        try:
            proc = await _spawn_before(
                deadline,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except asyncio.TimeoutError:
            raise FFmpegError("ffprobe timed out")
        
        try:
            tasks = [asyncio.create_task(proc.wait()),
                     asyncio.create_task(_bounded_drain(proc.stdout)),
                     asyncio.create_task(_bounded_drain(proc.stderr))]
            values = await asyncio.wait_for(
                asyncio.gather(*tasks), max(0.0, deadline - loop.time())
            )
            out, err = bytes(values[1]), bytes(values[2])
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            for task in tasks:
                task.cancel()
            await _stop_process(proc)
            await asyncio.gather(*tasks, return_exceptions=True)
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise FFmpegError("ffprobe timed out")
        
        if proc.returncode != 0:
            raise FFmpegError("ffprobe failed", err.decode(errors="replace"))
        
        return json.loads(out.decode(errors="replace"))
    
    @staticmethod
    def _parse_time(line: str) -> Optional[float]:
        """Parse time from ffmpeg progress line."""
        match = TIME_RE.search(line)
        if not match:
            return None
        h, m, s = match.groups()
        return int(h) * 3600 + int(m) * 60 + float(s)
    
    @staticmethod
    def _parse_speed(line: str) -> Optional[float]:
        """Parse speed from ffmpeg progress line."""
        match = SPEED_RE.search(line)
        if not match:
            return None
        try:
            return float(match.group(1))
        except:
            return None
