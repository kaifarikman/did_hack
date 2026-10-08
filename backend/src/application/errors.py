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


class ScenarioUnavailable(ApplicationError):
    """Профиль известен, но текущая среда его не применяет: повтор без смены среды не поможет."""

    code = "scenario_unavailable"


class NavigationTargetUnreachable(ApplicationError):
    """Цель вне карты, в запретной зоне, без пути туда/домой или без запаса энергии."""

    code = "navigation_target_unreachable"


class MapChanged(ApplicationError):
    """Цель выбрана по другой версии карты: нужна новая карта и подтверждение пользователя."""

    code = "map_changed"
