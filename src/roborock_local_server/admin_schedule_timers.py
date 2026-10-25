"""Verify a dashboard enable/disable change against an existing native timer."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from enum import StrEnum
import logging
from typing import Any


class TimerSyncError(RuntimeError):
    def __init__(self, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.status = status


class TimerCommand(StrEnum):
    GET = "get_server_timer"
    UPDATE = "upd_server_timer"


def _timer_state(timers: Any, name: str) -> str:
    if not isinstance(timers, list):
        raise TimerSyncError("The vacuum did not return a usable timer list. Refresh schedules and retry.")
    matches = [entry for entry in timers if isinstance(entry, list) and entry and entry[0] == name]
    if not matches:
        raise TimerSyncError("The linked robot timer is missing. Check this schedule in the Roborock app before retrying.", 409)
    if len(matches) != 1 or len(matches[0]) < 2 or matches[0][1] not in ("on", "off"):
        raise TimerSyncError("The linked robot timer is ambiguous. Check this schedule in the Roborock app before retrying.", 409)
    return matches[0][1]


async def sync_timer(
    supervisor: Any, duid: str, name: str, enabled: bool, *, check_current: Callable[[], None],
) -> str:
    """Update only the named timer; a fresh read is the success criterion.

    The app sends upd_server_timer before its HTTP job update. A timed-out write
    may still have reached the vacuum, so read it back without repeating the
    write. Never create a timer or infer one from a cloud job's numeric ID.
    """
    from shared.routine_runner import _RoutineMqttClient

    device = supervisor.runtime_credentials.resolve_device(duid=duid)
    if device is None or not device.get("localkey"):
        raise TimerSyncError("Connect this vacuum to the local server before changing its schedule.")
    desired = "on" if enabled else "off"
    client = None
    write_attempted = False
    try:
        async with asyncio.timeout(45):
            client = _RoutineMqttClient(supervisor.context, device, logging.getLogger(__name__))
            await client.connect()
            current = _timer_state(await client.send_command(TimerCommand.GET, []), name)
            # Recheck the job after the network read, before changing the robot.
            check_current()
            if current != desired:
                write_attempted = True
                try:
                    await client.send_command(TimerCommand.UPDATE, [[name, desired]])
                except Exception:
                    # A read-back can confirm a write whose acknowledgement was
                    # lost. It cannot confirm a refused or unapplied write.
                    pass
                current = _timer_state(await client.send_command(TimerCommand.GET, []), name)
                if current != desired:
                    raise TimerSyncError("The vacuum did not confirm the requested timer setting. Refresh schedules and retry.")
            return current
    except TimerSyncError:
        raise
    except Exception as exc:
        message = (
            "The robot timer may have changed, but verification failed. Refresh schedules and retry."
            if write_attempted else
            "Could not read this vacuum's timer. Make sure it is connected locally, then retry."
        )
        raise TimerSyncError(message) from exc
    finally:
        if client is not None:
            try:
                async with asyncio.timeout(5):
                    await client.close()
            except Exception:
                logging.getLogger(__name__).warning("Unable to close schedule timer connection")
