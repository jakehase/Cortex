"""Bounded ownership and cleanup for asyncio subprocesses."""

import asyncio
from typing import Any, Awaitable, Callable


def close_process_transports(proc: Any) -> None:
    """Best-effort close of pipes and the process transport."""
    for name in ("stdout", "stderr", "stdin"):
        stream = getattr(proc, name, None)
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


def observe_task(task: "asyncio.Task[Any]") -> None:
    """Consume a detached task's eventual exception without retaining results."""
    def consume(done: "asyncio.Task[Any]") -> None:
        try:
            done.result()
        except BaseException:
            pass

    task.add_done_callback(consume)


async def stop_process(proc: Any, grace: float) -> None:
    """Terminate then kill, placing a finite bound on each reap attempt."""
    wait_task = asyncio.create_task(proc.wait())
    if proc.returncode is None:
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        done, _ = await asyncio.wait({wait_task}, timeout=grace)
        if done:
            wait_task.result()
            return

        try:
            proc.kill()
        except ProcessLookupError:
            pass

        # A normal asyncio Process.wait is cancellable; start a fresh reap
        # after kill so fakes and alternate loops can observe the escalation.
        # If it resists cancellation, retain that one task as the late reaper.
        wait_task.cancel()
        await asyncio.sleep(0)
        if wait_task.done():
            try:
                wait_task.result()
            except BaseException:
                pass
            wait_task = asyncio.create_task(proc.wait())

    done, _ = await asyncio.wait({wait_task}, timeout=grace)
    if done:
        try:
            wait_task.result()
        except ProcessLookupError:
            pass
        return

    # Child watchers or test doubles need not cooperate with cancellation.
    # Closing transports releases pipe payloads; the remaining task retains
    # only the process long enough to observe a possible late reap.
    close_process_transports(proc)
    observe_task(wait_task)


def _clean_up_late_spawn(
    spawn_task: "asyncio.Task[Any]",
    stop: Callable[[Any], Awaitable[None]],
) -> None:
    try:
        proc = spawn_task.result()
    except BaseException:
        return
    cleanup = asyncio.create_task(stop(proc))
    observe_task(cleanup)


async def spawn_owned(
    spawn: Awaitable[Any],
    grace: float,
    stop: Callable[[Any], Awaitable[None]],
) -> Any:
    """Own a pending spawn while allowing cancellation to return promptly."""
    spawn_task = asyncio.create_task(spawn)
    try:
        return await asyncio.shield(spawn_task)
    except asyncio.CancelledError:
        done, _ = await asyncio.wait({spawn_task}, timeout=grace)
        if done:
            try:
                proc = spawn_task.result()
            except BaseException:
                pass
            else:
                await stop(proc)
        else:
            # create_subprocess_exec may already have forked. Attach ownership
            # before requesting cancellation: a resistant factory can still
            # return a child, while a normal pending factory releases payloads.
            spawn_task.add_done_callback(lambda task: _clean_up_late_spawn(task, stop))
            spawn_task.cancel()
        raise
