import { ContractError } from "../domain/validation";
import { ApiError, NetworkError, RequestTimeoutError } from "./errors";

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 409:
        return `Конфликт: ${error.message}`;
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
