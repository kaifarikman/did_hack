export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export class NetworkError extends Error {
  constructor(message = "Backend is unreachable") {
    super(message)
    this.name = "NetworkError"
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = "Backend did not respond in time") {
    super(message)
    this.name = "RequestTimeoutError"
  }
}
