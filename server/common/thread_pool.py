from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Callable, List, Sequence, TypeVar

T = TypeVar("T")
R = TypeVar("R")


def process_with_thread_pool(
    chunks: Sequence[T],
    func: Callable[[int, T], R],
    *,
    max_workers: int,
    timeout: int | float | None,
    on_error: Callable[[int, T, Exception], R],
) -> List[R]:
    """Process ``chunks`` in parallel with a thread pool.

    Parameters
    ----------
    chunks:
        Sequence of items to process.
    func:
        Callable invoked as ``func(index, chunk)`` returning a result.
    max_workers:
        Maximum number of worker threads.
    timeout:
        Per-chunk timeout in seconds. ``None`` or ``0`` waits indefinitely.
    on_error:
        Fallback invoked as ``on_error(index, chunk, exc)`` on timeout or other
        exceptions.
    """
    results: List[R] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(func, i + 1, ch) for i, ch in enumerate(chunks)]
        for i, fut in enumerate(futures, 1):
            try:
                if timeout in (0, None):
                    res = fut.result()
                else:
                    res = fut.result(timeout=timeout)
            except FuturesTimeout as e:
                res = on_error(i, chunks[i - 1], e)
            except Exception as e:  # pragma: no cover - passthrough to handler
                res = on_error(i, chunks[i - 1], e)
            results.append(res)
    return results


__all__ = ["process_with_thread_pool"]
