import type { MissionSnapshot, TeamOutcome } from "../domain/contract";
import { formatBattery, goalLabel, statusLabel, statusTone } from "../domain/presentation";

const OUTCOME_TEXT: Record<TeamOutcome, string> = {
  running: "Команда работает",
  success: "Общий успех: все роботы вернулись, есть подтверждённые сборы",
  partial: "Частичный результат: сборы есть, но не все роботы вернулись",
  failed: "Провал команды: нет подтверждённого сбора или возврата",
  stopped: "Прервано пользователем",
};

/** Командный прогон: отдельные исходы роботов не скрываются общим статусом. */
export function TeamPanel({ snapshot }: { snapshot: MissionSnapshot | null }) {
  const team = snapshot?.team ?? null;
  if (team === null || snapshot === null) return null;
  return (
    <section className="panel" aria-labelledby="team-title">
      <h2 id="team-title">Команда роботов</h2>
      <p className={`notice notice-${team.outcome === "success" ? "success" : team.outcome === "running" ? "warning" : "failure"}`}>
        {OUTCOME_TEXT[team.outcome]} · собрано всего {team.samples_collected}
        {team.coordinated ? "" : " · без координации (базовая линия)"}
      </p>
      {team.lost_robots.length > 0 && <p className="notice notice-failure">Потеряны: {team.lost_robots.join(", ")}</p>}
      <table className="hypotheses">
        <thead>
          <tr>
            <th scope="col">Робот</th>
            <th scope="col">Статус</th>
            <th scope="col">Батарея</th>
            <th scope="col">Сборы</th>
            <th scope="col">Цель / бронь</th>
          </tr>
        </thead>
        <tbody>
          {team.robots.map((robot) => (
            <tr key={robot.robot_id}>
              <th scope="row">{robot.robot_id}</th>
              <td><span className={`chip tone-${statusTone(robot.status)}`}>{statusLabel(robot.status)}</span></td>
              <td>{formatBattery(robot.battery_remaining, snapshot.battery_initial)}</td>
              <td>{robot.samples_collected}</td>
              <td>
                {robot.current_goal === null ? "—" : goalLabel(robot.current_goal.kind)}
                {robot.reservation !== null &&
                  ` · бронь (${robot.reservation.position_x_m.toFixed(1)}; ${robot.reservation.position_y_m.toFixed(1)})`}
                {robot.last_error !== null && <div className="step-meta">{robot.last_error.code}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
