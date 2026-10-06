export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Сервер недостижим: запрос мог не дойти или ответ потерян. */
export class NetworkError extends Error {
  constructor(message = "Нет связи с backend") {
    super(message);
    this.name = "NetworkError";
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = "Backend не ответил вовремя") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}
