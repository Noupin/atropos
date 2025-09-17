"""Logging helpers for pipeline steps with optional observer integration."""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Callable, Generator, TypeVar

from interfaces.progress import PipelineEvent, PipelineEventType, PipelineObserver

from .formatting import Fore, Style
from .notifications import send_failure_email

T = TypeVar("T")

_OBSERVER: ContextVar[PipelineObserver | None] = ContextVar("pipeline_observer", default=None)


def push_observer(observer: PipelineObserver | None) -> Token[PipelineObserver | None]:
    """Store ``observer`` in the context and return the token for later reset."""

    return _OBSERVER.set(observer)


def reset_observer(token: Token[PipelineObserver | None]) -> None:
    """Restore the previous observer using ``token`` returned from :func:`push_observer`."""

    _OBSERVER.reset(token)


def _get_observer(override: PipelineObserver | None) -> PipelineObserver | None:
    """Return the active observer, preferring ``override`` when provided."""

    return override if override is not None else _OBSERVER.get()


def run_step(
    name: str,
    func: Callable[..., T],
    *args: Any,
    step_id: str | None = None,
    observer: PipelineObserver | None = None,
    **kwargs: Any,
) -> T:
    """Run ``func`` as a pipeline step with colored logging and timing.

    Parameters
    ----------
    name:
        Descriptive name for the step to display in the logs.
    func:
        Callable to execute.
    *args, **kwargs:
        Arguments forwarded to ``func``.

    Returns
    -------
    T
        Whatever ``func`` returns.
    """
    obs = _get_observer(observer)
    print(f"{Fore.CYAN}{name}{Style.RESET_ALL}")
    if obs:
        obs.handle_event(
            PipelineEvent(
                type=PipelineEventType.STEP_STARTED,
                message=name,
                step=step_id or name,
            )
        )
    start = time.perf_counter()
    try:
        result = func(*args, **kwargs)
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(
            f"{Fore.RED}  ↳ failed after {Fore.MAGENTA}{elapsed:.2f}s{Fore.RED}: {exc}{Style.RESET_ALL}"
        )
        send_failure_email(
            f"Pipeline step failed: {name}",
            f"Step '{name}' failed after {elapsed:.2f}s with error: {exc}",
        )
        if obs:
            obs.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_FAILED,
                    message=str(exc),
                    step=step_id or name,
                    data={"elapsed_seconds": elapsed, "error": str(exc)},
                )
            )
        raise
    else:
        elapsed = time.perf_counter() - start
        print(
            f"{Fore.GREEN}  ↳ completed in {Fore.MAGENTA}{elapsed:.2f}s{Style.RESET_ALL}"
        )
        if obs:
            obs.handle_event(
                PipelineEvent(
                    type=PipelineEventType.STEP_COMPLETED,
                    message=name,
                    step=step_id or name,
                    data={"elapsed_seconds": elapsed},
                )
            )
        return result


@contextmanager
def log_timing(name: str) -> Generator[None, None, None]:
    """Context manager that logs start/end and timing with colors."""
    print(f"{Fore.CYAN}{name}{Style.RESET_ALL}")
    start = time.perf_counter()
    try:
        yield
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(
            f"{Fore.RED}  ↳ failed after {Fore.MAGENTA}{elapsed:.2f}s{Fore.RED}: {exc}{Style.RESET_ALL}"
        )
        raise
    else:
        elapsed = time.perf_counter() - start
        print(
            f"{Fore.GREEN}  ↳ completed in {Fore.MAGENTA}{elapsed:.2f}s{Style.RESET_ALL}"
        )
