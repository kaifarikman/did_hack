import json

from adapters.journal.jsonl import JsonlJournal
from adapters.journal.memory import InMemoryJournal
from domain.journal import JournalDraft, JournalKind


def draft(title: str, **fields) -> JournalDraft:
    return JournalDraft(JournalKind.DECISION, title, "детали", 1.5, **fields)


def test_pagination_by_sequence_and_has_more():
    journal = InMemoryJournal()
    for index in range(5):
        journal.append("r", draft(f"e{index}"))
    page, has_more = journal.read("r", 0, 2)
    assert [e.sequence for e in page] == [1, 2] and has_more
    page, has_more = journal.read("r", 4, 2)
    assert [e.sequence for e in page] == [5] and not has_more
    assert journal.read("r", 5, 2) == ([], False)
    assert journal.read("other", 0, 2) == ([], False)


def test_jsonl_persists_across_instances_with_unique_sequences(tmp_path):
    first = JsonlJournal(tmp_path)
    first.append("run-a", draft("one", hypothesis_id="h1", expected="э"))
    first.append("run-a", draft("two"))
    second = JsonlJournal(tmp_path)  # «перезапуск контейнера» с тем же томом
    entry = second.append("run-a", draft("three"))
    assert entry.sequence == 3
    entries, _ = second.read("run-a", 0, 10)
    assert [e.draft.title for e in entries] == ["one", "two", "three"]
    assert entries[0].draft.hypothesis_id == "h1" and entries[0].draft.kind is JournalKind.DECISION
    lines = (tmp_path / "run-a.jsonl").read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["sequence"] for line in lines] == [1, 2, 3]


def test_jsonl_rejects_unsafe_run_id(tmp_path):
    import pytest
    with pytest.raises(ValueError):
        JsonlJournal(tmp_path).append("../evil", draft("x"))
