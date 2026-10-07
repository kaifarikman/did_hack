import type { MissionSnapshot } from "../domain/contract";
import {
  goalLabel,
  hypothesisStatusLabel,
  sensorLabel,
  sensorTone,
  stepStatusLabel,
} from "../domain/presentation";

interface ResearchPanelProps {
  snapshot: MissionSnapshot | null;
}

/** План и состояние исследования. Всё здесь — оценки и решения агента, не истина сценария. */
export function ResearchPanel({ snapshot }: ResearchPanelProps) {
  const plan = snapshot?.plan ?? null;
  const research = snapshot?.research ?? null;
  if (snapshot === null || (plan === null && research === null)) {
    return (
      <section className="panel" aria-labelledby="research-title">
        <h2 id="research-title">План и исследование</h2>
        <p className="hint">План появится после запуска миссии.</p>
      </section>
    );
  }
  const terminal = snapshot.status === "completed" || snapshot.status === "stopped" || snapshot.status === "failed";

  return (
    <section className="panel research-panel" aria-labelledby="research-title">
      <h2 id="research-title">План и исследование</h2>
      <p className="hint">Оценки и решения агента; скрытая разметка сценария здесь не показывается.</p>

      {plan !== null && (
        <div className="plan">
          <h3>
            {terminal ? "Последний план" : "Текущий план"} {plan.plan_id}{" "}
            <span className="chip">{plan.source === "llm" ? "LLM" : "алгоритмический резерв"}</span>
          </h3>
          <ol className="plan-steps">
            {plan.steps.map((step, index) => (
              <li key={index} className={`plan-step step-${step.status}`}>
                <span className="step-status">{stepStatusLabel(step.status)}</span>{" "}
                <strong>{goalLabel(step.kind)}</strong>
                {step.target !== null && ` → (${step.target.position_x_m.toFixed(2)}; ${step.target.position_y_m.toFixed(2)})`}
                <div className="step-reason">{step.reason}</div>
                {step.revise_if !== null && <div className="step-meta">Пересмотреть, если: {step.revise_if}</div>}
                {step.evidence.length > 0 && <div className="step-meta">Опора: {step.evidence.join(", ")}</div>}
              </li>
            ))}
          </ol>
          <p><strong>Обоснование:</strong> {plan.rationale}</p>
          {plan.premises.length > 0 && <p><strong>Предпосылки:</strong> {plan.premises.join("; ")}</p>}
          {plan.fallback_reason !== null && (
            <p className="notice notice-warning">Резерв вместо LLM: {plan.fallback_reason}</p>
          )}
          {plan.revision_reason !== null && <p><strong>План пересмотрен:</strong> {plan.revision_reason}</p>}
        </div>
      )}

      {research !== null && (
        <>
          <div className="chips">
            <span className={`chip tone-${sensorTone(research.sensor.state)}`}>
              Датчик образцов: {sensorLabel(research.sensor.state, research.sensor.fault)} · доверие{" "}
              {research.sensor.quality.toFixed(1)}
            </span>
            <span className="chip">Запросов плана: {research.planner_requests}</span>
            <span className="chip">Наблюдаемых опасностей: {research.hazards.length}</span>
          </div>
          {research.last_replan_reason !== null && (
            <p className="notice notice-warning">
              Последнее перепланирование: {research.last_replan_reason}
              {research.last_replan_detection_id !== null && ` (${research.last_replan_detection_id})`}
            </p>
          )}
          {research.hypotheses.length > 0 && (
            <table className="hypotheses">
              <caption>Гипотезы и проверки</caption>
              <thead>
                <tr>
                  <th scope="col">Гипотеза</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Прогноз до проверки</th>
                  <th scope="col">Независимое измерение</th>
                </tr>
              </thead>
              <tbody>
                {research.hypotheses.map((item) => (
                  <tr key={item.hypothesis_id}>
                    <th scope="row">
                      {item.hypothesis_id}
                      {item.detection_id !== null && <div className="step-meta">{item.detection_id}</div>}
                      {item.experiment_id !== null && <div className="step-meta">{item.experiment_id}</div>}
                    </th>
                    <td>{hypothesisStatusLabel(item.status)}</td>
                    <td>{item.prediction}</td>
                    <td>{item.measurement ?? "ещё нет"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
