import json

import pytest

from adapters.llm.config import LlmConfig
from adapters.llm.openai_planner import LlmResponseError, OpenAiCompatiblePlanner, parse_subgoal
from adapters.llm.prompt import build_user_message
from adapters.llm.transport import TransportError
from application.planner import FallbackPlanner, ResilientPlanner
from application.ports import PlannerError
from domain.geometry import Point, Pose
from domain.settings import MissionSettings
from domain.subgoals import Candidate, GoalKind, PlanningContext

SECRET = "sk-secret-123"
CONFIG = LlmConfig("http://llm.test/v1/chat/completions", "model-x", SECRET, timeout_s=1, max_attempts=2)


def context(**overrides) -> PlanningContext:
    values = dict(
        run_id="r", pose=Pose(0, 0, 0), base=Point(-2, -0.5), battery_remaining=40, battery_initial=60,
        sample_signal=0.2, best_signal=0.3, samples_collected=0, return_energy_estimate=3.0,
        reserve_low=False, decisions_made=1, decisions_since_improvement=0, collect_attempts_here=0,
        total_collect_attempts=0, candidates=(Candidate(Point(1, 1), 1.0, 0.3),),
    )
    values.update(overrides)
    return PlanningContext(**values)


class FakeTransport:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []

    def post_json(self, url, payload, api_key, timeout_s):
        self.requests.append((url, payload, api_key, timeout_s))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def chat(content) -> dict:
    return {"choices": [{"message": {"content": content}}]}


GOOD = json.dumps({"kind": "explore", "target": {"position_x_m": 1.0, "position_y_m": 1.0}, "reason": "кандидат"})
never = lambda: False


def test_valid_reply_becomes_llm_subgoal_with_reason():
    planner = OpenAiCompatiblePlanner(CONFIG, FakeTransport([chat(GOOD)]))
    goal = planner.propose(context(), never)
    assert goal.kind is GoalKind.EXPLORE and goal.target == Point(1.0, 1.0)
    assert goal.source == "llm" and goal.reason == "кандидат"


def test_prompt_contains_only_allowed_observations():
    message = build_user_message(context())
    assert "candidates" in message and "battery_remaining" in message
    for forbidden in ("true_", "hidden", "sample_position", "seed"):
        assert forbidden not in message


@pytest.mark.parametrize("content", [
    "не json",
    json.dumps({"kind": "dance", "target": None, "reason": "x"}),
    json.dumps({"kind": "explore", "target": None, "reason": "x"}),
    json.dumps({"kind": "explore", "target": {"position_x_m": "1", "position_y_m": 1}, "reason": "x"}),
    json.dumps({"kind": "explore", "target": {"position_x_m": float("nan"), "position_y_m": 1}, "reason": "x"}),
    json.dumps({"kind": "collect", "target": None, "reason": ""}),
    json.dumps({"kind": "collect", "target": None, "reason": "x", "speed": 1}),
    json.dumps([1, 2]),
])
def test_schema_violations_are_rejected(content):
    with pytest.raises(LlmResponseError):
        parse_subgoal(content)


def test_json_in_code_fence_is_accepted():
    assert parse_subgoal("```json\n" + GOOD + "\n```").kind is GoalKind.EXPLORE


@pytest.mark.parametrize("replies,fragment", [
    ([TransportError("таймаут")] * 2, "LLM недоступна"),
    ([TransportError("HTTP 500")] * 2, "LLM недоступна"),
    ([chat("мусор")] * 2, "неверный ответ"),
    ([{"unexpected": 1}] * 2, "неверный ответ"),
    ([chat(None)] * 2, "неверный ответ"),
])
def test_failures_raise_planner_error_after_bounded_retries(replies, fragment):
    transport = FakeTransport(replies)
    with pytest.raises(PlannerError, match=fragment):
        OpenAiCompatiblePlanner(CONFIG, transport).propose(context(), never)
    assert len(transport.requests) == 2


def test_retry_succeeds_on_second_attempt():
    transport = FakeTransport([TransportError("таймаут"), chat(GOOD)])
    assert OpenAiCompatiblePlanner(CONFIG, transport).propose(context(), never).source == "llm"


def test_cancelled_request_makes_no_call():
    transport = FakeTransport([chat(GOOD)])
    with pytest.raises(PlannerError, match="отменён"):
        OpenAiCompatiblePlanner(CONFIG, transport).propose(context(), lambda: True)
    assert transport.requests == []


def test_resilient_planner_falls_back_visibly_for_each_failure_and_without_key():
    settings = MissionSettings()
    for transport in (FakeTransport([TransportError("x")] * 2), FakeTransport([chat("мусор")] * 2)):
        planner = ResilientPlanner(OpenAiCompatiblePlanner(CONFIG, transport), FallbackPlanner(settings))
        goal = planner.propose(context(), never)
        assert goal.source == "fallback" and "fallback" in goal.reason
        assert planner.last_fallback_reason
    no_key = ResilientPlanner(None, FallbackPlanner(settings))
    assert no_key.propose(context(), never).source == "fallback"
    assert no_key.last_fallback_reason == "LLM не настроена"


def test_config_from_environment_requires_all_values_and_hides_key():
    assert LlmConfig.from_environment({"LLM_ENDPOINT": "u", "LLM_MODEL": "m"}) is None
    config = LlmConfig.from_environment({"LLM_ENDPOINT": "u", "LLM_MODEL": "m", "LLM_API_KEY": SECRET})
    assert config.api_key == SECRET and SECRET not in repr(config)


def test_key_is_sent_only_to_transport_and_never_in_payload_or_errors():
    transport = FakeTransport([TransportError("HTTP 401")] * 2)
    with pytest.raises(PlannerError) as caught:
        OpenAiCompatiblePlanner(CONFIG, transport).propose(context(), never)
    assert SECRET not in str(caught.value)
    for _, payload, api_key, _ in transport.requests:
        assert api_key == SECRET and SECRET not in json.dumps(payload, ensure_ascii=False)
