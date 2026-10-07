"""Перевод доменных значений в JSON контракта /api/v1 (snake_case, метры, радианы)."""
from __future__ import annotations

import math

from application.run_service import JournalPage
from domain.geometry import Point
from domain.grid import OccupancyGrid
from domain.journal import JournalEntry
from domain.mission import MissionSnapshot

SCHEMA_VERSION = "1.1"  # 1.1: совместимые поля плана, исследования и текста миссии


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
                "std_energy_per_m": _number(t.std_energy_per_m), "regime": t.regime,
                "last_measured_s": _number(t.last_measured_s),
            }
            for t in snapshot.terrain_estimates
        ],
        "last_error": None if error is None else {
            "code": error.code, "message": error.message, "retryable": error.retryable,
        },
        "mission_text": snapshot.mission_text,
        "map_mode": snapshot.map_mode,
        "target_samples": snapshot.target_samples,
        "plan": plan_json(snapshot),
        "research": research_json(snapshot),
        "team": team_json(snapshot),
    }


def team_json(snapshot: MissionSnapshot) -> dict | None:
    team = snapshot.team
    if team is None:
        return None
    return {
        "outcome": team.outcome,
        "samples_collected": team.samples_collected,
        "coordinated": team.coordinated,
        "lost_robots": list(team.lost_robots),
        "robots": [
            {
                "robot_id": robot.robot_id,
                "status": robot.status.value,
                "robot_pose": None if robot.pose is None else {**point_json(robot.pose.point), "heading_rad": robot.pose.heading_rad},
                "battery_remaining": _number(robot.battery_remaining),
                "samples_collected": robot.samples_collected,
                "current_goal": None if robot.current_goal is None else {
                    "kind": robot.current_goal.kind.value,
                    "target": None if robot.current_goal.target is None else point_json(robot.current_goal.target),
                    "reason": robot.current_goal.reason,
                },
                "trajectory": [point_json(p) for p in robot.trajectory],
                "planned_path": [point_json(p) for p in robot.planned_path],
                "reservation": None if robot.reservation is None else point_json(robot.reservation),
                "last_error": None if robot.last_error is None else {
                    "code": robot.last_error.code, "message": robot.last_error.message,
                    "retryable": robot.last_error.retryable,
                },
            }
            for robot in team.robots
        ],
    }


def plan_json(snapshot: MissionSnapshot) -> dict | None:
    plan = snapshot.plan
    if plan is None:
        return None
    return {
        "plan_id": plan.plan_id,
        "source": plan.source,
        "rationale": plan.rationale,
        "premises": list(plan.premises),
        "fallback_reason": plan.fallback_reason,
        "revision_reason": snapshot.plan_revision_reason,
        "steps": [
            {
                "kind": step.goal.kind.value,
                "target": None if step.goal.target is None else point_json(step.goal.target),
                "reason": step.goal.reason,
                "status": status.value,
                "evidence": list(step.evidence),
                "revise_if": step.revise_if,
            }
            for step, status in zip(plan.steps, snapshot.plan_statuses)
        ],
    }


def research_json(snapshot: MissionSnapshot) -> dict | None:
    view = snapshot.research
    if view is None:
        return None
    return {
        "sensor": {"state": view.sensor_state, "fault": view.sensor_fault, "quality": view.sensor_quality},
        "hazards": [
            {"detection_id": h.detection_id, "center": point_json(h.center), "radius_m": h.radius_m, "hits": h.hits}
            for h in view.hazards
        ],
        "hypotheses": [
            {
                "hypothesis_id": h.hypothesis_id, "kind": h.kind, "status": h.status,
                "center": point_json(h.center), "prediction": h.prediction, "measurement": h.measurement,
                "detection_id": h.detection_id, "experiment_id": h.experiment_id,
            }
            for h in view.hypotheses
        ],
        "last_replan_reason": view.last_replan_reason,
        "last_replan_detection_id": view.last_replan_detection_id,
        "planner_requests": view.planner_requests,
    }


def map_json(grid: OccupancyGrid) -> dict:
    return {
        "map_id": grid.versioned_id,
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
        "robot_id": draft.robot_id,
    }


def journal_page_json(page: JournalPage) -> dict:
    return {
        "run_id": page.run_id,
        "entries": [entry_json(e) for e in page.entries],
        "next_sequence": page.next_sequence,
        "has_more": page.has_more,
    }
