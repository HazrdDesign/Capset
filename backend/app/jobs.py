"""In-memory job store.

Transcription takes long enough that a synchronous HTTP call would hang the
panel, so work is submitted, tracked, and polled. One worker thread: the
model is not guaranteed thread-safe, and two concurrent transcriptions on
one machine would contend for the same cores anyway.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

log = logging.getLogger(__name__)


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class Job:
    id: str
    state: JobState = JobState.QUEUED
    progress: float = 0.0
    stage: str = "queued"
    result: Any = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    _cancel: threading.Event = field(default_factory=threading.Event, repr=False)

    @property
    def is_terminal(self) -> bool:
        return self.state in (JobState.DONE, JobState.ERROR, JobState.CANCELLED)

    def to_dict(self) -> dict:
        payload = {
            "id": self.id,
            "state": self.state.value,
            "progress": round(self.progress, 4),
            "stage": self.stage,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }
        if self.state is JobState.DONE:
            payload["result"] = self.result
        if self.state is JobState.ERROR:
            payload["error"] = self.error
        return payload


class JobStore:
    def __init__(self, retention_s: float = 3600.0, max_workers: int = 1):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max_workers)
        self._retention_s = retention_s

    def submit(self, work: Callable[[Job], Any]) -> Job:
        self._prune()
        job = Job(id=uuid.uuid4().hex)
        with self._lock:
            self._jobs[job.id] = job
        self._pool.submit(self._run, job, work)
        return job

    def _run(self, job: Job, work: Callable[[Job], Any]) -> None:
        if job._cancel.is_set():
            job.state = JobState.CANCELLED
            job.finished_at = time.time()
            return
        job.state = JobState.RUNNING
        job.stage = "starting"
        try:
            job.result = work(job)
            # Work that honours cancellation returns early; do not overwrite.
            if job._cancel.is_set():
                job.state = JobState.CANCELLED
            else:
                job.state = JobState.DONE
                job.progress = 1.0
                job.stage = "complete"
        except Exception as exc:
            log.exception("job %s failed", job.id)
            job.state = JobState.ERROR
            job.error = f"{type(exc).__name__}: {exc}"
        finally:
            job.finished_at = time.time()

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self.get(job_id)
        if job is None or job.is_terminal:
            return False
        job._cancel.set()
        return True

    def _prune(self) -> None:
        cutoff = time.time() - self._retention_s
        with self._lock:
            stale = [
                jid
                for jid, job in self._jobs.items()
                if job.finished_at is not None and job.finished_at < cutoff
            ]
            for jid in stale:
                del self._jobs[jid]

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
