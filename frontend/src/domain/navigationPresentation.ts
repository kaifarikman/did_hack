import type { MissionSnapshot, NavigationPhase, NavigationView } from "./contract";
import { isActiveStatus } from "./presentation";

const PHASE_LABELS: Record<NavigationPhase, string> = {
  pending: "Подготовка: backend проверяет карту, путь и энергию",
  moving_to_target: "Движение к заданной точке",
  returning: "Возврат на базу",
  finished: "Миссия завершена",
  stopped: "Остановлено пользователем",
  failed: "Миссия не выполнена",
};

export function navigationPhaseLabel(phase: NavigationPhase): string {
  return PHASE_LABELS[phase];
}

export type NavigationStageState = "done" | "current" | "todo" | "failed";

export interface NavigationStage {
  id: "check" | "move" | "reached" | "return" | "finish";
  label: string;
  state: NavigationStageState;
}

/**
 * Этапы показывают отдельно «цель достигнута» и «миссия завершена»:
 * достижение точки — не конец, пока нет возврата и подтверждённого finish.
 */
export function navigationStages(snapshot: MissionSnapshot): NavigationStage[] {
  const navigation = snapshot.navigation;
  if (navigation === null) return [];
  const { phase, target_reached: reached } = navigation;
  const terminalFailure = phase === "failed" || phase === "stopped";
  const completed = snapshot.status === "completed" && phase === "finished" && reached;

  const stage = (
    id: NavigationStage["id"],
    label: string,
    done: boolean,
    current: boolean,
  ): NavigationStage => ({
    id,
    label,
    state: done ? "done" : current ? "current" : terminalFailure ? "failed" : "todo",
  });

  const returning = phase === "returning" || (reached && !completed && !terminalFailure);
  return [
    stage("check", "Проверка цели", phase !== "pending", phase === "pending"),
    stage("move", "Движение к цели", reached || completed, phase === "moving_to_target" && !reached),
    stage("reached", "Цель достигнута", reached, false),
    stage("return", "Возврат на базу", completed, returning),
    stage("finish", "Миссия завершена (finish подтверждён)", completed, false),
  ];
}

export type NavigationOutcomeKind = "success" | "warning" | "failure" | "progress";

export interface NavigationOutcome {
  kind: NavigationOutcomeKind;
  title: string;
  detail: string;
}

/** Итог описывает именно навигационную задачу; null, пока прогон не начался. */
export function navigationOutcome(snapshot: MissionSnapshot): NavigationOutcome | null {
  const navigation = snapshot.navigation;
  if (navigation === null) return null;
  const reached = navigation.target_reached;
  const timeNote =
    navigation.target_reached_at_s === null ? "" : ` (время симуляции ${navigation.target_reached_at_s.toFixed(1)} с)`;

  if (snapshot.status === "completed") {
    return reached && navigation.phase === "finished"
      ? {
          kind: "success",
          title: "Цель достигнута, робот вернулся на базу",
          detail: `Судья подтвердил завершение${timeNote}.`,
        }
      : {
          kind: "warning",
          title: "Прогон завершён, но достижение цели не подтверждено",
          detail: "Успех по навигации не засчитывается без отметки о достижении цели.",
        };
  }
  if (snapshot.status === "stopped") {
    return {
      kind: "warning",
      title: "Остановлено пользователем",
      detail: reached
        ? `Цель была достигнута${timeNote}, но возврат не завершён: это не успешное завершение.`
        : "Цель не достигнута. Это не успешное завершение.",
    };
  }
  if (snapshot.status === "failed") {
    if (snapshot.last_error?.code === "navigation_goal_not_reached") {
      return {
        kind: "failure",
        title: "Цель не достигнута",
        detail: "Энергии не хватило на достижение точки; робот безопасно вернулся или остановлен. Успех не засчитан.",
      };
    }
    return {
      kind: "failure",
      title: reached ? "Цель достигнута, но миссия не завершена из-за ошибки" : "Миссия завершилась ошибкой",
      detail: "Успех не засчитан.",
    };
  }
  if (isActiveStatus(snapshot.status) && reached) {
    return {
      kind: "progress",
      title: "Цель достигнута — миссия ещё не завершена",
      detail: `Робот возвращается на базу${timeNote}; завершение подтвердится после finish.`,
    };
  }
  return null;
}

/** Цель можно менять только когда прогона нет или он завершён. */
export function isGoalLocked(snapshot: MissionSnapshot | null): boolean {
  return snapshot !== null && isActiveStatus(snapshot.status);
}

export function describeUserGoal(navigation: NavigationView): string {
  return `X ${navigation.target.position_x_m.toFixed(2)} м, Y ${navigation.target.position_y_m.toFixed(2)} м`;
}
