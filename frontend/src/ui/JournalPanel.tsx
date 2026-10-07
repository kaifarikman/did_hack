import { useState } from "react";
import type { MissionController } from "../application/missionController";
import type { MissionViewState } from "../application/viewState";
import type { JournalKind } from "../domain/contract";
import {
  buildHypothesisChain,
  filterJournal,
  JOURNAL_KIND_LABELS,
  JOURNAL_KINDS,
  listHypothesisIds,
} from "../domain/journal";
import { NO_DATA } from "../domain/presentation";
import { downloadJson } from "./download";

interface JournalPanelProps {
  view: MissionViewState;
  controller: MissionController;
}

export function JournalPanel({ view, controller }: JournalPanelProps) {
  const [kindFilter, setKindFilter] = useState<JournalKind | "all">("all");
  const { journal, exportState, snapshot, selectedHypothesisId } = view;
  const visible = filterJournal(journal.entries, kindFilter);
  const hypothesisIds = listHypothesisIds(journal.entries);
  const chain = selectedHypothesisId === null ? null : buildHypothesisChain(journal.entries, selectedHypothesisId);

  async function handleExport() {
    const result = await controller.exportJournal();
    if (result !== null) downloadJson(`journal-${result.run_id}.json`, result);
  }

  return (
    <section className="panel journal-panel" aria-labelledby="journal-title">
      <div className="panel-header">
        <h2 id="journal-title">Журнал исследования</h2>
        <label className="inline-field">
          Тип события
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as JournalKind | "all")}>
            <option value="all">Все</option>
            {JOURNAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>{JOURNAL_KIND_LABELS[kind]}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={snapshot?.run_id == null || exportState.phase === "exporting"}
          onClick={() => void handleExport()}
        >
          {exportState.phase === "exporting" ? "Выгрузка…" : "Экспорт JSON"}
        </button>
      </div>

      {journal.error !== null && <p className="notice notice-warning" role="status">Журнал: {journal.error}</p>}
      {exportState.message !== null && (
        <p className={`notice ${exportState.phase === "cancelled" ? "notice-warning" : "notice-failure"}`} role="alert">
          {exportState.message}
        </p>
      )}

      {hypothesisIds.length > 0 && (
        <div className="hypothesis-picker">
          <span>Цепочка гипотезы:</span>
          {hypothesisIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === selectedHypothesisId}
              onClick={() => controller.selectHypothesis(id === selectedHypothesisId ? null : id)}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      {chain !== null && (
        <div className="chain" aria-label={`Цепочка гипотезы ${chain.hypothesis_id}`}>
          <h3>Гипотеза {chain.hypothesis_id}</h3>
          <ol>
            <li><strong>Ожидание:</strong> {chain.expectations.join(" · ") || NO_DATA}</li>
            <li><strong>Эксперимент:</strong> {chain.experiments.map((entry) => entry.title).join(" · ") || "ещё не проводился"}</li>
            <li><strong>Наблюдение:</strong> {chain.observations.join(" · ") || "ещё нет"}</li>
            <li>
              <strong>Вывод:</strong>{" "}
              {chain.conclusions.length > 0 ? chain.conclusions.join(" · ") : <em>вывод ещё не сделан</em>}
            </li>
          </ol>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="hint">{journal.entries.length === 0 ? "Записей пока нет." : "Нет записей выбранного типа."}</p>
      ) : (
        <ol className="entries">
          {visible.map((entry) => (
            <li key={entry.sequence} className={`entry kind-${entry.kind}`}>
              <details>
                <summary>
                  <span className="entry-seq">#{entry.sequence}</span>
                  <span className="entry-time">{entry.simulation_time_s === null ? "—" : `${entry.simulation_time_s.toFixed(1)} с`}</span>
                  <span className="entry-kind">{JOURNAL_KIND_LABELS[entry.kind]}</span>
                  <span className="entry-title">{entry.title}</span>
                </summary>
                <p>{entry.detail}</p>
                {entry.expected !== null && <p><strong>Ожидание:</strong> {entry.expected}</p>}
                {entry.observed !== null && <p><strong>Наблюдение:</strong> {entry.observed}</p>}
                {entry.conclusion !== null && <p><strong>Вывод:</strong> {entry.conclusion}</p>}
                {(entry.plan_id ?? entry.experiment_id ?? entry.detection_id) !== null || entry.evidence.length > 0 ? (
                  <p className="entry-links">
                    {entry.plan_id !== null && <span className="chip">{entry.plan_id}</span>}
                    {entry.experiment_id !== null && <span className="chip">{entry.experiment_id}</span>}
                    {entry.detection_id !== null && <span className="chip">{entry.detection_id}</span>}
                    {entry.evidence.length > 0 && <span className="chip">опора: {entry.evidence.join(", ")}</span>}
                  </p>
                ) : null}
                {entry.hypothesis_id !== null && (
                  <button type="button" onClick={() => controller.selectHypothesis(entry.hypothesis_id)}>
                    Показать цепочку {entry.hypothesis_id}
                  </button>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
