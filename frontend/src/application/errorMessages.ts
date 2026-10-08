import { ContractError } from "../domain/validation";
import { ApiError, NetworkError, RequestTimeoutError } from "./errors";

/** Коды D1: сообщение составляется на клиенте, без сырого текста транспорта и backend. */
const DESCRIBED_CODES: Record<string, string> = {
  navigation_target_unreachable:
    "Точка недостижима: она вне карты, в запретной или неизвестной зоне, либо до неё или обратно на базу нет допустимого пути. Выберите другую точку.",
  map_changed:
    "Карта изменилась с момента выбора точки. Проверьте точку на обновлённой карте, подтвердите её и запустите заново.",
  run_conflict: "Другой прогон уже активен, либо этот идентификатор команды уже использован с иными параметрами.",
  scenario_unavailable: "Этот режим пока недоступен в текущей среде: навигация поддерживается только в профиле easy, карта static, один робот.",
  environment_not_ready: "Среда не готова: нет свежих наблюдений или карты. Подождите несколько секунд и повторите.",
  invalid_request: "Запрос отклонён: проверьте координаты X и Y и выбранный режим.",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const known = DESCRIBED_CODES[error.code];
    if (known !== undefined) return known;
    switch (error.status) {
      case 409:
        return error.code === "scenario_unavailable"
          ? `Профиль недоступен в текущей среде: ${error.message}`
          : `Конфликт: ${error.message}`;
      case 422:
        return `Запрос отклонён: ${error.message}`;
      case 503:
        return `Среда не готова: ${error.message}`;
      default:
        return error.message;
    }
  }
  if (error instanceof NetworkError || error instanceof RequestTimeoutError || error instanceof ContractError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

/** Исход команды неизвестен: запрос мог дойти до backend. */
export function isUnknownOutcome(error: unknown): boolean {
  return (
    error instanceof NetworkError || error instanceof RequestTimeoutError || error instanceof ContractError
  );
}
