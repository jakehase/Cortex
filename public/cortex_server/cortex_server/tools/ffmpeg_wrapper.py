"""
FFmpeg CLI Wrapper - Safe, typed interface to FFmpeg.
"""

import asyncio
import json
import re
from typing import Dict, List, Optional, Callable, Any
from pathlib import Path
from pydantic import BaseModel, Field, field_validator


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
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        stderr_lines = []
        
        async def read_stderr():
            while True:
                try:
                    line = await proc.stderr.readline()
                    if not line:
                        break
                    text = line.decode(errors="replace").strip()
                    stderr_lines.append(text)
                    
                    if on_progress:
                        current_time = self._parse_time(text)
                        speed = self._parse_speed(text)
                        if current_time is not None and speed is not None:
                            on_progress(current_time, total_time or 0.0, speed)
                except Exception:
                    break
        
        stderr_task = asyncio.create_task(read_stderr())
        
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise FFmpegError(
                f"ffmpeg timed out after {timeout}s",
                "\n".join(stderr_lines),
            )
        except asyncio.CancelledError:
            proc.kill()
            await proc.wait()
            raise
        finally:
            await stderr_task
        
        if proc.returncode != 0:
            raise FFmpegError(
                f"ffmpeg failed with exit code {proc.returncode}",
                "\n".join(stderr_lines),
                proc.returncode,
            )
        
        return "\n".join(stderr_lines)
    
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
        args += ["-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k"]
        
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
    
    async def get_info(self, input_path: str) -> Dict[str, Any]:
        """Get media file information using ffprobe."""
        args = [
            self.ffprobe_bin,
            "-v", "error",
            "-show_entries", "format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height",
            "-of", "json",
            input_path,
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        
        out, err = await proc.communicate()
        
        if proc.returncode != 0:
            raise FFmpegError("ffprobe failed", err.decode())
        
        return json.loads(out.decode())
    
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