"""FastAPI-адаптер контракта /api/v1. Никакой бизнес-логики и команд скорости."""
from __future__ import annotations

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from adapters.http.serialization import journal_page_json, map_json, snapshot_json
from application.errors import (
    ApplicationError, EnvironmentNotReady, InvalidRequest, RunConflict, ScenarioUnavailable, UnknownRun,
)
from application.ports import EnvironmentStatus, MapSource
from application.run_service import RunService

_STATUS_BY_ERROR = {
    InvalidRequest: 422, UnknownRun: 404, RunConflict: 409, EnvironmentNotReady: 503,
    ScenarioUnavailable: 409,
}


class StartRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: StrictStr
    scenario: StrictStr
    seed: StrictInt
    mission_text: StrictStr | None = None


class StopRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: StrictStr


def _error(status: int, code: str, message: str, retryable: bool) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "retryable": retryable}},
    )


def create_app(service: RunService, environment: EnvironmentStatus, maps: MapSource) -> FastAPI:
    app = FastAPI(title="DID backend", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(ApplicationError)
    async def application_error(_: Request, error: ApplicationError) -> JSONResponse:
        return _error(_STATUS_BY_ERROR.get(type(error), 500), error.code, error.message, error.retryable)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        return _error(422, "invalid_request", "Неверное тело или параметры запроса.", False)

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, error: Exception) -> JSONResponse:
        # без traceback и деталей: наружу только код
        return _error(503, "internal_error", "Внутренняя ошибка backend.", True)

    @app.get("/api/v1/health")
    def health() -> dict:
        ready = environment.ros_connected() and maps.load() is not None
        return {
            "status": "ready" if ready else "starting",
            "ros_connected": environment.ros_connected(),
            "judge_mode": environment.judge_mode,
            "llm_available": environment.llm_available(),
            "supported_scenarios": list(environment.supported_scenarios()),
        }

    @app.get("/api/v1/state")
    def state() -> dict:
        return snapshot_json(service.state())

    @app.get("/api/v1/map", response_model=None)
    def map_() -> JSONResponse | dict:
        grid = maps.load()
        if grid is None:
            return _error(503, "map_not_loaded", "Карта ещё не загружена.", True)
        return map_json(grid)

    @app.post("/api/v1/runs", status_code=202)
    def start_run(body: StartRunBody) -> dict:
        return snapshot_json(service.start_run(body.request_id, body.scenario, body.seed, body.mission_text))

    @app.post("/api/v1/runs/{run_id}/stop", status_code=202)
    def stop_run(run_id: str, body: StopRunBody) -> dict:
        return snapshot_json(service.stop_run(body.request_id, run_id))

    @app.get("/api/v1/runs/{run_id}/journal")
    def journal(
        run_id: str,
        after_sequence: int = Query(0),
        limit: int = Query(100),
    ) -> dict:
        return journal_page_json(service.journal_page(run_id, after_sequence, limit))

    return app
