import { describe, expect, it } from "vitest";
import { ApiError } from "../src/application/errors";
import { ExportCancelledError, ExportFailedError, exportFullJournal } from "../src/application/exportJournal";
import { MissionController } from "../src/application/missionController";
import type { MissionGateway } from "../src/application/ports";
import type { JournalEntry, JournalPage } from "../src/domain/contract";
import { ControlledGateway, FakeScheduler, entry, flush, idle, readyHealth, exampleMap, snapshotWith } from "./support";

/** Журнал на стороне «backend»: страницы режутся по limit, записи можно дописывать между запросами. */
class ScriptedJournal {
  entries: JournalEntry[];
  calls: Array<{ after: number; limit: number }> = [];
  hooks: Array<(callIndex: number) => void | Promise<void>> = [];
  failOnCall: number | null = null;
  overrideByCall = new Map<number, JournalPage>();

  constructor(count: number) {
    this.entries = Array.from({ length: count }, (_unused, index) => entry(index + 1));
  }

  gateway(runId = "run-a", pageSizeCap = 200): MissionGateway {
    const journal = this;
    return {
      async getJournalPage(requestedRun, after, limit) {
        const callIndex = journal.calls.length;
        journal.calls.push({ after, limit });
        for (const hook of journal.hooks) await hook(callIndex);
        if (journal.failOnCall === callIndex) throw new ApiError(503, "unavailable", "сбой", true);
        const override = journal.overrideByCall.get(callIndex);
        if (override !== undefined) return override;
        const matching = journal.entries.filter((item) => item.sequence > after);
        const page = matching.slice(0, Math.min(limit, pageSizeCap));
        const last = page[page.length - 1];
        return {
          run_id: requestedRun === runId ? runId : requestedRun,
          entries: page,
          next_sequence: last?.sequence ?? after,
          has_more: matching.length > page.length,
        };
      },
    } as MissionGateway;
  }
}

const never = () => false;

describe("полный экспорт журнала", () => {
  it("читает журнал больше двух страниц и совпадает с полным содержимым", async () => {
    const journal = new ScriptedJournal(7);
    const result = await exportFullJournal(journal.gateway("run-a", 3), "run-a", { isCancelled: never });
    expect(journal.calls.map((call) => call.after)).toEqual([0, 3, 6]);
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result).toMatchObject({ run_id: "run-a", last_sequence: 7, entry_count: 7 });
  });

  it("повторяющаяся/перекрывающаяся страница не дублирует записи", async () => {
    const journal = new ScriptedJournal(4);
    journal.overrideByCall.set(1, {
      run_id: "run-a",
      entries: [entry(2), entry(3), entry(4)],
      next_sequence: 4,
      has_more: false,
    });
    const gateway = journal.gateway("run-a", 2);
    const result = await exportFullJournal(gateway, "run-a", { isCancelled: never });
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("пустой журнал даёт валидный пустой файл с курсором 0", async () => {
    const result = await exportFullJournal(new ScriptedJournal(0).gateway(), "run-a", { isCancelled: never });
    expect(result).toMatchObject({ entry_count: 0, last_sequence: 0, entries: [] });
  });

  it("страница без продвижения курсора при has_more завершается ошибкой, а не зацикливается", async () => {
    const journal = new ScriptedJournal(2);
    journal.overrideByCall.set(0, { run_id: "run-a", entries: [entry(1)], next_sequence: 1, has_more: true });
    journal.overrideByCall.set(1, { run_id: "run-a", entries: [], next_sequence: 1, has_more: true });
    await expect(exportFullJournal(journal.gateway(), "run-a", { isCancelled: never })).rejects.toBeInstanceOf(ExportFailedError);
  });

  it("сбой в середине не выдаёт частичный файл", async () => {
    const journal = new ScriptedJournal(7);
    journal.failOnCall = 1;
    await expect(exportFullJournal(journal.gateway("run-a", 3), "run-a", { isCancelled: never })).rejects.toBeInstanceOf(ApiError);
  });

  it("новые записи во время выгрузки: граница — next_sequence последней страницы, позднее — в следующий экспорт", async () => {
    const journal = new ScriptedJournal(4);
    journal.hooks.push((callIndex) => {
      if (callIndex === 1) journal.entries.push(entry(5), entry(6)); // пока читается вторая страница
    });
    const result = await exportFullJournal(journal.gateway("run-a", 2), "run-a", { isCancelled: never });
    // страница 1: 1-2, страница 2 (уже с 5,6 в источнике): 3-4, has_more -> страница 3: 5-6
    expect(result.entries.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.last_sequence).toBe(6);

    journal.entries.push(entry(7)); // после первой выгрузки
    const next = await exportFullJournal(journal.gateway("run-a", 2), "run-a", { isCancelled: never });
    expect(next.entries).toHaveLength(7);
    expect(result.entries).toHaveLength(6); // прежний файл неизменен
  });

  it("смена прогона во время выгрузки отменяет её", async () => {
    const journal = new ScriptedJournal(7);
    let cancelled = false;
    journal.hooks.push((callIndex) => {
      if (callIndex === 1) cancelled = true;
    });
    await expect(
      exportFullJournal(journal.gateway("run-a", 3), "run-a", { isCancelled: () => cancelled }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it("журнал другого прогона отвергается", async () => {
    const journal = new ScriptedJournal(1);
    journal.overrideByCall.set(0, { run_id: "run-b", entries: [entry(1)], next_sequence: 1, has_more: false });
    await expect(exportFullJournal(journal.gateway(), "run-a", { isCancelled: never })).rejects.toBeInstanceOf(ExportFailedError);
  });
});

describe("экспорт через контроллер", () => {
  async function bootRunning() {
    const gateway = new ControlledGateway();
    const scheduler = new FakeScheduler();
    const controller = new MissionController({ gateway, scheduler, generateId: () => "id" });
    controller.start();
    gateway.healthCalls[0]?.deferred.resolve(readyHealth);
    gateway.mapCalls[0]?.deferred.resolve(exampleMap());
    gateway.stateCalls[0]?.deferred.resolve(snapshotWith({ run_id: "run-a", revision: 3, status: "completed" }));
    await flush();
    return { gateway, scheduler, controller };
  }

  it("читает все страницы независимо от фильтра экрана и возвращает файл", async () => {
    const { gateway, controller } = await bootRunning();
    gateway.journalCalls[0]?.deferred.resolve({ run_id: "run-a", entries: [entry(1)], next_sequence: 1, has_more: false });
    await flush();
    const exporting = controller.exportJournal();
    await flush();
    const call = gateway.journalCalls[gateway.journalCalls.length - 1];
    expect(call?.after).toBe(0);
    call?.deferred.resolve({ run_id: "run-a", entries: [entry(1), entry(2)], next_sequence: 2, has_more: false });
    const result = await exporting;
    expect(result?.entry_count).toBe(2);
    expect(controller.getView().exportState.phase).toBe("idle");
  });

  it("смена run_id отменяет выгрузку и сообщает об этом", async () => {
    const { gateway, scheduler, controller } = await bootRunning();
    const exporting = controller.exportJournal();
    await flush();
    const exportCall = gateway.journalCalls[gateway.journalCalls.length - 1];
    await scheduler.advance(500);
    gateway.stateCalls[gateway.stateCalls.length - 1]?.deferred.resolve(
      snapshotWith({ run_id: "run-b", revision: 1, status: "starting" }),
    );
    await flush();
    exportCall?.deferred.resolve({ run_id: "run-a", entries: [entry(1)], next_sequence: 1, has_more: true });
    expect(await exporting).toBeNull();
    expect(controller.getView().exportState).toMatchObject({ phase: "cancelled" });
    expect(controller.getView().exportState.message).toContain("сменился прогон");
  });

  it("ошибка чтения помечается как неполная выгрузка без файла", async () => {
    const { gateway, controller } = await bootRunning();
    const exporting = controller.exportJournal();
    await flush();
    gateway.journalCalls[gateway.journalCalls.length - 1]?.deferred.reject(new ApiError(503, "x", "сбой", true));
    expect(await exporting).toBeNull();
    expect(controller.getView().exportState.phase).toBe("failed");
    expect(controller.getView().exportState.message).toContain("Файл не создан");
  });

  it("пагинация журнала на экране продолжается по has_more и убирает дубликаты", async () => {
    const { gateway, controller } = await bootRunning();
    gateway.journalCalls[0]?.deferred.resolve({ run_id: "run-a", entries: [entry(1), entry(2)], next_sequence: 2, has_more: true });
    await flush();
    expect(gateway.journalCalls[1]?.after).toBe(2);
    gateway.journalCalls[1]?.deferred.resolve({ run_id: "run-a", entries: [entry(2), entry(3)], next_sequence: 3, has_more: false });
    await flush();
    const view = controller.getView();
    expect(view.journal.entries.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(view.journal.nextSequence).toBe(3);
    // терминальный прогон и журнал дочитан — повторных запросов нет
    expect(gateway.journalCalls).toHaveLength(2);
    void idle;
  });
});
