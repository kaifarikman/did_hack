"""Ошибки прикладного уровня; HTTP-адаптер переводит их в коды контракта."""


class ApplicationError(Exception):
    code = "error"
    retryable = False

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class InvalidRequest(ApplicationError):
    code = "invalid_request"


class UnknownRun(ApplicationError):
    code = "run_not_found"


class RunConflict(ApplicationError):
    code = "run_conflict"


class EnvironmentNotReady(ApplicationError):
    code = "environment_not_ready"
    retryable = True
