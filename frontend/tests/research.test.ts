import { describe, expect, it } from "vitest";
import stateRunningExample from "../src/adapters/fixture/examples/state-running.json";
import { placeLabels, terrainLabel } from "../src/domain/presentation";
import { ContractError, parseJournalPage, parseSnapshot } from "../src/domain/validation";

function legacySnapshot(): Record<string, unknown> {
  const copy = structuredClone(stateRunningExample) as Record<string, unknown>;
  for (const key of ["mission_text", "target_samples", "plan", "research"]) delete copy[key];
  copy.schema_version = "1.0";
  copy.terrain_estimates = (copy.terrain_estimates as Array<Record<string, unknown>>).map(
    ({ std_energy_per_m: _std, regime: _regime, last_measured_s: _last, ...rest }) => rest,
  );
  return copy;
}

describe("контракт 1.1: план и исследование", () => {
  it("пример 1.1 даёт план с шагами и состояние датчика", () => {
    const snapshot = parseSnapshot(structuredClone(stateRunningExample));
    expect(snapshot.plan?.steps.length).toBeGreaterThan(0);
    expect(snapshot.plan?.steps[0]?.status).toBeDefined();
    expect(snapshot.research?.sensor.state).toBe("ok");
    expect(snapshot.research?.hazards[0]?.detection_id).toBe("hazard-1");
    expect(snapshot.target_samples).toBe(3);
    expect(snapshot.terrain_estimates[0]?.std_energy_per_m).not.toBeNull();
  });

  it("снимок backend 1.0 без новых полей принимается со значениями по умолчанию", () => {
    const snapshot = parseSnapshot(legacySnapshot());
    expect(snapshot.plan).toBeNull();
    expect(snapshot.research).toBeNull();
    expect(snapshot.mission_text).toBe("");
    expect(snapshot.terrain_estimates[0]?.std_energy_per_m).toBeNull();
    expect(snapshot.terrain_estimates[0]?.regime).toBe(0);
  });

  it("неизвестный статус шага и качество датчика вне 0..1 — ошибка контракта", () => {
    const badStep = structuredClone(stateRunningExample) as { plan: { steps: Array<{ status: string }> } };
    badStep.plan.steps[0]!.status = "maybe";
    expect(() => parseSnapshot(badStep)).toThrow(ContractError);
    const badSensor = structuredClone(stateRunningExample) as { research: { sensor: { quality: number } } };
    badSensor.research.sensor.quality = 1.5;
    expect(() => parseSnapshot(badSensor)).toThrow(ContractError);
  });

  it("запись журнала без полей связей получает пустые значения", () => {
    const page = parseJournalPage({
      run_id: "r",
      next_sequence: 1,
      has_more: false,
      entries: [{ sequence: 1, simulation_time_s: 1, kind: "decision", title: "t", detail: "d",
        hypothesis_id: null, expected: null, observed: null, conclusion: null }],
    });
    expect(page.entries[0]).toMatchObject({ plan_id: null, detection_id: null, experiment_id: null, evidence: [] });
  });
});

describe("подписи карты", () => {
  it("пересекающиеся подписи не рисуются поверх друг друга", () => {
    const placed = placeLabels([
      { x: 0, y: 0, width: 50, height: 12 },
      { x: 10, y: 5, width: 50, height: 12 },
      { x: 0, y: 20, width: 50, height: 12 },
    ]);
    expect(placed).toHaveLength(2);
    expect(placed[1]?.y).toBe(20);
  });

  it("оценка показывает неопределённость и режим", () => {
    const base = { region_id: "c", center: { position_x_m: 0, position_y_m: 0 }, radius_m: 0.25, confidence: 0.5 };
    expect(terrainLabel({ ...base, energy_per_m: 2.94, std_energy_per_m: 0.31, regime: 1, last_measured_s: 3 })).toBe(
      "2.9±0.3/м · режим 1",
    );
    expect(terrainLabel({ ...base, energy_per_m: 1, std_energy_per_m: null, regime: 0, last_measured_s: null })).toBe("1.0/м");
  });
});

import stateTeamPartial from "../src/adapters/fixture/examples/state-team-partial.json";
import stateSlamRunning from "../src/adapters/fixture/examples/state-slam-running.json";

describe("fixtures команды и SLAM", () => {
  it("частичный результат команды: исходы роботов видны отдельно", () => {
    const snapshot = parseSnapshot(structuredClone(stateTeamPartial));
    expect(snapshot.team?.robots.map((robot) => robot.robot_id)).toEqual(["robot_1", "robot_2"]);
    expect(snapshot.team?.lost_robots).toEqual(["robot_2"]);
    expect(snapshot.team?.robots.every((robot) => robot.freshness.battery.fresh === true)).toBe(true);
    expect(["partial", "failed"]).toContain(snapshot.team?.outcome);
    expect(snapshot.status).toBe("failed");
  });

  it("SLAM: режим карты и версия карты в идентификаторе", () => {
    const snapshot = parseSnapshot(structuredClone(stateSlamRunning));
    expect(snapshot.map_mode).toBe("slam");
    expect(snapshot.map_id).toMatch(/#r\d+$/);
  });
});
