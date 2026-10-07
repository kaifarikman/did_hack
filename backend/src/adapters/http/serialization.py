"""Перевод доменных значений в JSON контракта /api/v1 (snake_case, метры, радианы)."""
from __future__ import annotations

import math

from application.run_service import JournalPage
from domain.geometry import Point
from domain.grid import OccupancyGrid
from domain.journal import JournalEntry
from domain.mission import MissionSnapshot

SCHEMA_VERSION = "1.0"


def _number(value: float | None) -> float | None:
    """NaN/Infinity запрещены контрактом: превращаются в отсутствующее измерение."""
    if value is None or not math.isfinite(value):
        return None
    return value


def point_json(point: Point) -> dict:
    return {"position_x_m": point.x_m, "position_y_m": point.y_m}


def snapshot_json(snapshot: MissionSnapshot) -> dict:
    pose, goal, error = snapshot.robot_pose, snapshot.current_goal, snapshot.last_error
    return {
        "schema_version": SCHEMA_VERSION,
        "run_id": snapshot.run_id,
        "revision": snapshot.revision,
        "status": snapshot.status.value,
        "scenario": snapshot.scenario,
        "seed": snapshot.seed,
        "judge_mode": snapshot.judge_mode,
        "planner_mode": snapshot.planner_mode,
        "simulation_time_s": _number(snapshot.simulation_time_s),
        "map_id": snapshot.map_id,
        "robot_pose": None if pose is None else {**point_json(pose.point), "heading_rad": pose.heading_rad},
        "base_position": None if snapshot.base_position is None else point_json(snapshot.base_position),
        "battery_remaining": _number(snapshot.battery_remaining),
        "battery_initial": snapshot.battery_initial,
        "sample_signal": _number(snapshot.sample_signal),
        "samples_collected": snapshot.samples_collected,
        "return_energy_estimate": _number(snapshot.return_energy_estimate),
        "current_goal": None if goal is None else {
            "kind": goal.kind.value,
            "target": None if goal.target is None else point_json(goal.target),
            "reason": goal.reason,
        },
        "trajectory": [point_json(p) for p in snapshot.trajectory],
        "planned_path": [point_json(p) for p in snapshot.planned_path],
        "collected_samples": [
            {"sample_id": s.sample_id, "position": point_json(s.position)} for s in snapshot.collected_samples
        ],
        "terrain_estimates": [
            {
                "region_id": t.region_id, "center": point_json(t.center), "radius_m": t.radius_m,
                "energy_per_m": t.energy_per_m, "confidence": t.confidence,
            }
            for t in snapshot.terrain_estimates
        ],
        "last_error": None if error is None else {
            "code": error.code, "message": error.message, "retryable": error.retryable,
        },
    }


def map_json(grid: OccupancyGrid) -> dict:
    return {
        "map_id": grid.map_id,
        "resolution_m": grid.resolution_m,
        "width": grid.width,
        "height": grid.height,
        "origin": {**point_json(Point(grid.origin.x_m, grid.origin.y_m)), "heading_rad": grid.origin.heading_rad},
        "cells": list(grid.cells),
    }


def entry_json(entry: JournalEntry) -> dict:
    draft = entry.draft
    return {
        "sequence": entry.sequence,
        "simulation_time_s": _number(draft.simulation_time_s),
        "kind": draft.kind.value,
        "title": draft.title,
        "detail": draft.detail,
        "hypothesis_id": draft.hypothesis_id,
        "expected": draft.expected,
        "observed": draft.observed,
        "conclusion": draft.conclusion,
        "experiment_id": draft.experiment_id,
        "detection_id": draft.detection_id,
        "plan_id": draft.plan_id,
        "evidence": list(draft.evidence),
    }


def journal_page_json(page: JournalPage) -> dict:
    return {
        "run_id": page.run_id,
        "entries": [entry_json(e) for e in page.entries],
        "next_sequence": page.next_sequence,
        "has_more": page.has_more,
    }
