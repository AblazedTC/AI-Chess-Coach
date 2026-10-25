import asyncio
import time
import uuid
from collections import OrderedDict

from app.config import Settings
from app.engine import Analyzer
from app.errors import AppError
from app.games import GameStore
from app.models import AnalysisJob

TERMINAL = {"completed", "cancelled", "failed"}


class Jobs:
    def __init__(self, settings: Settings, games: GameStore, analyzer: Analyzer):
        self.settings = settings
        self.games = games
        self.analyzer = analyzer
        self.jobs: OrderedDict[str, AnalysisJob] = OrderedDict()
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.finished: dict[str, float] = {}

    def _prune(self) -> None:
        now = time.monotonic()
        for job_id in list(self.finished):
            if now - self.finished[job_id] >= self.settings.cache_ttl_seconds:
                self.jobs.pop(job_id, None)
                del self.finished[job_id]

    def create(self, game_id: str) -> AnalysisJob:
        self._prune()
        game = self.games.get(game_id)
        active = [job for job in self.jobs.values() if job.status not in TERMINAL]
        for job in active:
            if job.game_id == game_id:
                return job.model_copy(deep=True)
        if len(active) >= self.settings.max_active_jobs:
            raise AppError(429, "job_limit", "Too many active analysis jobs. Cancel or wait.")
        while len(self.jobs) >= self.settings.max_jobs:
            oldest = next((key for key, job in self.jobs.items() if job.status in TERMINAL), None)
            if oldest is None:
                raise AppError(429, "job_limit", "Analysis job storage is full.")
            del self.jobs[oldest]
            self.finished.pop(oldest, None)
        job = AnalysisJob(
            id=uuid.uuid4().hex,
            game_id=game_id,
            status="queued",
            completed=0,
            total=len(game.positions),
            analyses=[],
        )
        self.jobs[job.id] = job
        task = asyncio.create_task(self._run(job), name=f"analysis-{job.id}")
        self.tasks[job.id] = task
        task.add_done_callback(lambda _: self.tasks.pop(job.id, None))
        return job.model_copy(deep=True)

    async def _run(self, job: AnalysisJob) -> None:
        try:
            job.status = "running"
            for ply in range(job.total):
                analysis = await self.analyzer.analyze(job.game_id, ply)
                job.analyses.append(analysis)
                job.completed = len(job.analyses)
                await asyncio.sleep(0)
            job.status = "completed"
        except asyncio.CancelledError:
            job.status = "cancelled"
            raise
        except AppError as exc:
            job.status = "failed"
            job.error = exc.message
        except Exception:
            job.status = "failed"
            job.error = "Analysis could not be completed."
        finally:
            self.finished[job.id] = time.monotonic()

    def get(self, job_id: str) -> AnalysisJob:
        self._prune()
        job = self.jobs.get(job_id)
        if job is None:
            raise AppError(404, "job_not_found", "Analysis job not found or expired.")
        return job.model_copy(deep=True)

    async def cancel(self, job_id: str) -> AnalysisJob:
        job = self.get(job_id)
        if job.status not in TERMINAL:
            self.jobs[job_id].status = "cancelled"
            task = self.tasks.get(job_id)
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            self.finished[job_id] = time.monotonic()
        return self.get(job_id)

    async def close(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for job in self.jobs.values():
            if job.status not in TERMINAL:
                job.status = "cancelled"
