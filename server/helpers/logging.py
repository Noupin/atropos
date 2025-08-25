import time
from contextlib import contextmanager
from typing import Callable, TypeVar, Any, Generator

from .formatting import Fore, Style

T = TypeVar('T')


def run_step(name: str, func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
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
    print(f"{Fore.CYAN}{name}{Style.RESET_ALL}")
    start = time.perf_counter()
    try:
        result = func(*args, **kwargs)
    except Exception as exc:
        elapsed = time.perf_counter() - start
        print(
            f"{Fore.RED}{name} failed after {elapsed:.2f}s: {exc}{Style.RESET_ALL}"
        )
        raise
    else:
        elapsed = time.perf_counter() - start
        print(f"{Fore.GREEN}{name} completed in {elapsed:.2f}s{Style.RESET_ALL}")
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
            f"{Fore.RED}{name} failed after {elapsed:.2f}s: {exc}{Style.RESET_ALL}"
        )
        raise
    else:
        elapsed = time.perf_counter() - start
        print(f"{Fore.GREEN}{name} completed in {elapsed:.2f}s{Style.RESET_ALL}")
