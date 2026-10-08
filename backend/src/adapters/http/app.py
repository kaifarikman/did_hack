"""FastAPI-адаптер контракта /api/v1. Никакой бизнес-логики и команд скорости."""
from __future__ import annotations

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictFloat, StrictInt, StrictStr

from adapters.http.serialization import journal_page_json, map_json, snapshot_json
from application.errors import (
    ApplicationError, EnvironmentNotReady, InvalidRequest, MapChanged, NavigationTargetUnreachable, RunConflict,
    ScenarioUnavailable, UnknownRun,
)
from application.ports import EnvironmentStatus, MapSource
from application.run_service import RunService
from domain.geometry import Point
from domain.navigation_task import NavigationTarget

_STATUS_BY_ERROR = {
    InvalidRequest: 422, UnknownRun: 404, RunConflict: 409, EnvironmentNotReady: 503,
    ScenarioUnavailable: 409, NavigationTargetUnreachable: 422, MapChanged: 409,
}


class NavigationTargetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position_x_m: StrictFloat | StrictInt
    position_y_m: StrictFloat | StrictInt
    map_id: StrictStr

    def to_target(self) -> NavigationTarget:
        return NavigationTarget(Point(float(self.position_x_m), float(self.position_y_m)), self.map_id)


class StartRunBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: StrictStr
    scenario: StrictStr
    seed: StrictInt
    mission_text: StrictStr | None = None
    map_mode: StrictStr = "static"
    robot_count: StrictInt = 1
    task_type: StrictStr = "research"
    navigation_target: NavigationTargetBody | None = None


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
            "supported_map_modes": list(environment.supported_map_modes()),
            "supported_robot_counts": list(environment.supported_robot_counts()),
            "supported_task_types": list(service.supported_task_types()),
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
        target = None if body.navigation_target is None else body.navigation_target.to_target()
        return snapshot_json(service.start_run(
            body.request_id, body.scenario, body.seed, body.mission_text, body.map_mode, body.robot_count,
            task_type=body.task_type, navigation_target=target,
        ))

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
