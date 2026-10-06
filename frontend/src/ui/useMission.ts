import { useEffect, useSyncExternalStore } from "react";
import type { MissionController } from "../application/missionController";
import type { MissionViewState } from "../application/viewState";

/** Подключает контроллер к React: запуск при монтировании, освобождение при размонтировании. */
export function useMission(controller: MissionController): MissionViewState {
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);
  return useSyncExternalStore(controller.subscribe, controller.getView);
}
