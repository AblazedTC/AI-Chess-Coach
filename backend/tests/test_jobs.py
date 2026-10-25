import asyncio
import time

import pytest

from app.config import Settings
from app.engine import Analyzer, Engine
from app.errors import AppError
from app.games import DEMO_PGN, GameStore
from app.jobs import Jobs
from app.models import PositionAnalysis


def setup(settings: Settings) -> tuple[GameStore, Analyzer, Jobs]:
    games = GameStore(settings)
    analyzer = Analyzer(settings, games, Engine(settings))
    return games, analyzer, Jobs(settings, games, analyzer)


async def test_job_cancel_active_and_immediate(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    games, analyzer, jobs = setup(settings)
    game = games.import_pgn(DEMO_PGN)
    entered = asyncio.Event()

    async def blocked(*_: object) -> PositionAnalysis:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(analyzer, "analyze", blocked)
    job = jobs.create(game.id)
    assert jobs.create(game.id).id == job.id
    await entered.wait()
    assert jobs.get(job.id).status == "running"
    cancelled = await jobs.cancel(job.id)
    assert cancelled.status == "cancelled"
    assert cancelled.completed == 0
    assert job.id not in jobs.tasks
    assert (await jobs.cancel(job.id)).status == "cancelled"
    immediate = jobs.create(game.id)
    assert (await jobs.cancel(immediate.id)).status == "cancelled"
    await jobs.close()


async def test_cancelling_job_retains_capacity_until_cleanup_finishes(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.max_jobs = settings.max_active_jobs = 1
    games, analyzer, jobs = setup(settings)
    first = games.import_pgn("1. e4 *")
    other = games.import_pgn("1. d4 *")
    entered = asyncio.Event()
    cleaning = asyncio.Event()
    release = asyncio.Event()

    async def blocked(*_: object) -> PositionAnalysis:
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaning.set()
            await release.wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(analyzer, "analyze", blocked)
    job = jobs.create(first.id)
    await entered.wait()
    cancellation = asyncio.create_task(jobs.cancel(job.id))
    try:
        await cleaning.wait()
        with pytest.raises(AppError) as caught:
            jobs.create(other.id)
        assert caught.value.status == 429
        assert jobs.get(job.id).id == job.id
    finally:
        release.set()
        result = await cancellation
        await jobs.close()
    assert result.status == "cancelled"


async def test_cancel_receipt_survives_eviction_after_task_finishes(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.max_jobs = settings.max_active_jobs = 1
    games, analyzer, jobs = setup(settings)
    first = games.import_pgn("1. e4 *")
    other = games.import_pgn("1. d4 *")
    entered = asyncio.Event()

    async def blocked(*_: object) -> PositionAnalysis:
        entered.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(analyzer, "analyze", blocked)
    job = jobs.create(first.id)
    await entered.wait()
    replacements = []
    jobs.tasks[job.id].add_done_callback(lambda _: replacements.append(jobs.create(other.id)))
    try:
        result = await jobs.cancel(job.id)
        assert result.id == job.id
        assert result.status == "cancelled"
        assert len(replacements) == 1
        with pytest.raises(AppError):
            jobs.get(job.id)
    finally:
        await jobs.close()


async def test_job_limit_terminal_eviction(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.max_jobs = 2
    settings.max_active_jobs = 1
    games, analyzer, jobs = setup(settings)
    a = games.import_pgn("1. e4 *")
    b = games.import_pgn("1. d4 *")

    async def blocked(*_: object) -> PositionAnalysis:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    monkeypatch.setattr(analyzer, "analyze", blocked)
    first = jobs.create(a.id)
    with pytest.raises(AppError) as caught:
        jobs.create(b.id)
    assert caught.value.status == 429
    await jobs.cancel(first.id)
    second = jobs.create(a.id)
    await jobs.cancel(second.id)
    third = jobs.create(b.id)
    with pytest.raises(AppError) as caught:
        jobs.get(first.id)
    assert caught.value.status == 404
    assert len(jobs.jobs) == 2
    await jobs.close()
    assert jobs.get(third.id).status == "cancelled"


@pytest.mark.parametrize("typed", [True, False])
async def test_job_failure_sanitized(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, typed: bool
) -> None:
    games, analyzer, jobs = setup(settings)
    game = games.import_pgn(DEMO_PGN)

    async def fail(*_: object) -> PositionAnalysis:
        if typed:
            raise AppError(503, "engine_unavailable", "Stockfish is unavailable.")
        raise RuntimeError("secret provider credential")

    monkeypatch.setattr(analyzer, "analyze", fail)
    job = jobs.create(game.id)
    await asyncio.gather(*list(jobs.tasks.values()))
    result = jobs.get(job.id)
    assert result.status == "failed"
    assert result.completed == 0
    assert result.error
    assert "secret" not in result.error
    assert (await jobs.cancel(job.id)).status == "failed"
    await jobs.close()


async def test_job_ttl(settings: Settings) -> None:
    games, _, jobs = setup(settings)
    game = games.import_pgn("1. e4 *")
    job = jobs.create(game.id)
    await asyncio.gather(*list(jobs.tasks.values()))
    assert jobs.get(job.id).status == "completed"
    jobs.finished[job.id] = time.monotonic() - settings.cache_ttl_seconds - 1
    with pytest.raises(AppError) as caught:
        jobs.get(job.id)
    assert caught.value.status == 404
    assert not jobs.jobs and not jobs.finished
    await jobs.close()


async def test_cached_analysis_and_mutable_responses(settings: Settings) -> None:
    games, analyzer, jobs = setup(settings)
    game = games.import_pgn(DEMO_PGN)
    a = await analyzer.analyze(game.id, 0)
    expected = a.model_copy(deep=True)
    a.score.value = 9999
    a.lines.clear()
    b = await analyzer.analyze(game.id, 0)
    assert b == expected
    # Response models are not aliases for the engine's cached evaluation.
    await jobs.close()
