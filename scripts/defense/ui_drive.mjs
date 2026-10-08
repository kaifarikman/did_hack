#!/usr/bin/env node
// Проход демо через настоящий UI панели в headless Chrome (DevTools Protocol, без внешних зависимостей).
// Клики мышью по карте и кнопкам, ввод с клавиатуры. Каждую секунду — кадры панели и Gazebo (noVNC).
//
//   node scripts/defense/ui_drive.mjs --out DIR --x X --y Y [--stop-after S] [--timeout S]
//   node scripts/defense/ui_drive.mjs --out DIR --watch S        только кадры, без действий
//
// --x/--y — цель в метрах; выбирается кликом по карте (пиксель вычисляется по двум пробным кликам,
// которые только выбирают точку). --stop-after — нажать Stop через S секунд после старта.
// Состояние прогона читается из GET /api/v1/state (только чтение) и пишется в DIR/timeline.jsonl.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PANEL_URL = process.env.PANEL_URL ?? "http://localhost:8090";
const VNC_URL = process.env.VNC_URL ?? "http://localhost:6090/vnc.html?autoconnect=true&resize=scale&view_only=true";
const DEBUG_PORT = 9333;
const PANEL_SIZE = { width: 1456, height: 1000 };
const VNC_SIZE = { width: 1280, height: 800 };
const TERMINAL = new Set(["completed", "failed", "stopped"]);

const args = parseArguments(process.argv.slice(2));
const outDir = args.out;
mkdirSync(join(outDir, "frames"), { recursive: true });
const timelinePath = join(outDir, "timeline.jsonl");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArguments(list) {
  const parsed = {};
  for (let index = 0; index < list.length; index += 2) parsed[list[index].replace(/^--/, "")] = list[index + 1];
  if (!parsed.out) throw new Error("нужен --out");
  return parsed;
}

function log(event, details = {}) {
  const line = { time: new Date().toISOString(), event, ...details };
  appendFileSync(timelinePath, JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line));
}

class Browser {
  async launch() {
    const profile = mkdtempSync(join(tmpdir(), "defense-chrome-"));
    this.process = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
    let version = null;
    for (let attempt = 0; attempt < 50 && version === null; attempt += 1) {
      await sleep(200);
      version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()).catch(() => null);
    }
    this.socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve) => this.socket.addEventListener("open", resolve, { once: true }));
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (message) => {
      const payload = JSON.parse(message.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async openPage(url, size) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId);
    await page.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.enable");
    await page.send("Page.navigate", { url });
    return page;
  }

  close() {
    this.socket.close();
    this.process.kill();
  }
}

class Page {
  constructor(browser, sessionId) {
    this.browser = browser;
    this.sessionId = sessionId;
  }

  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.result.value;
  }

  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async screenshot(path) {
    const { data } = await this.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    writeFileSync(path, Buffer.from(data, "base64"));
  }

  /** Центр видимого элемента: селектор + необязательный фрагмент текста. */
  async centerOf(selector, text = "") {
    return this.evaluate(`(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => node.textContent.includes(${JSON.stringify(text)}));
      if (!element) return null;
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
  }

  async clickElement(selector, text = "") {
    const center = await this.centerOf(selector, text);
    if (center === null) throw new Error(`не найден элемент ${selector} «${text}»`);
    await this.click(center.x, center.y);
  }

  async draftPoint() {
    return this.evaluate(`(() => {
      const inputs = document.querySelectorAll(".nav-draft input");
      return inputs.length === 2 ? { x: inputs[0].value, y: inputs[1].value } : null;
    })()`);
  }

  async bodyText() {
    return this.evaluate("document.body.innerText");
  }
}

async function readState() {
  return fetch(`${PANEL_URL}/api/v1/state`).then((r) => r.json()).catch((error) => ({ error: String(error) }));
}

/** Пиксель карты для мировой точки: две пробные точки задают масштаб и сдвиг (карта без поворота). */
async function pickOnMap(panel, target) {
  const rect = await panel.evaluate(`(() => {
    const canvas = document.querySelector(".map-canvas-wrap canvas");
    canvas.scrollIntoView({ block: "center" });
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  })()`);
  const probes = [
    { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.45 },
    { x: rect.left + rect.width * 0.55, y: rect.top + rect.height * 0.55 },
  ];
  const worlds = [];
  for (const probe of probes) {
    await panel.click(probe.x, probe.y);
    await sleep(300);
    const draft = await panel.draftPoint();
    worlds.push({ x: Number(draft.x.replace(",", ".")), y: Number(draft.y.replace(",", ".")) });
  }
  const scaleX = (probes[1].x - probes[0].x) / (worlds[1].x - worlds[0].x);
  const scaleY = (probes[1].y - probes[0].y) / (worlds[1].y - worlds[0].y);
  const pixel = { x: probes[0].x + (target.x - worlds[0].x) * scaleX, y: probes[0].y + (target.y - worlds[0].y) * scaleY };
  await panel.click(pixel.x, pixel.y);
  await sleep(300);
  const chosen = await panel.draftPoint();
  log("map_click", { target, pixel, chosen, pixels_per_m: Math.abs(scaleX) });
  return chosen;
}

/** Ввод координат с клавиатуры в поля X/Y панели (тройной клик выделяет прежнее значение). */
async function typeTarget(panel, xText, yText) {
  for (const [index, text] of [[0, xText], [1, yText]]) {
    const center = await panel.evaluate(`(() => {
      const rect = document.querySelectorAll(".nav-draft input")[${index}].getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await panel.send("Input.dispatchMouseEvent", { type: "mousePressed", ...center, button: "left", clickCount: 3 });
    await panel.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...center, button: "left", clickCount: 3 });
    await panel.send("Input.insertText", { text });
    await sleep(200);
  }
  const chosen = await panel.draftPoint();
  log("typed_target", { typed: { x: xText, y: yText }, chosen,
    status_text: await panel.evaluate(`document.querySelector("#nav-draft-status")?.innerText ?? ""`) });
  return chosen;
}

async function main() {
  const browser = new Browser();
  await browser.launch();
  const panel = await browser.openPage(PANEL_URL, PANEL_SIZE);
  const vnc = await browser.openPage(VNC_URL, VNC_SIZE);
  await sleep(6000);
  let frame = 0;
  const capture = async (label) => {
    frame += 1;
    const name = String(frame).padStart(4, "0");
    await panel.screenshot(join(outDir, "frames", `panel-${name}.jpg`));
    await vnc.screenshot(join(outDir, "frames", `gazebo-${name}.jpg`));
    if (label) {
      await panel.screenshot(join(outDir, `panel-${label}.jpg`));
      await vnc.screenshot(join(outDir, `gazebo-${label}.jpg`));
    }
  };

  const health = await fetch(`${PANEL_URL}/api/v1/health`).then((r) => r.json());
  log("health", health);
  await capture("ready");

  if (args.watch) {
    const until = Date.now() + Number(args.watch) * 1000;
    while (Date.now() < until) {
      await capture();
      await sleep(1000);
    }
    await capture("watch-end");
    log("watch_text", { text: (await panel.bodyText()).slice(0, 1500) });
    browser.close();
    return;
  }

  if (args["stop-only"]) {
    await panel.clickElement("button", "Stop");
    log("stop_clicked", { status: (await readState()).status });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(1000);
      await capture();
      const state = await readState();
      if (TERMINAL.has(state.status)) {
        log("state", { status: state.status, run_id: state.run_id, phase: state.navigation?.phase, last_error: state.last_error });
        break;
      }
    }
    await capture("stopped");
    browser.close();
    return;
  }

  await panel.clickElement("label", "В заданную точку");
  await sleep(500);
  const chosen = args.type
    ? await typeTarget(panel, args.x, args.y)
    : await pickOnMap(panel, { x: Number(args.x), y: Number(args.y) });
  await capture("target-selected");
  const before = await readState();
  await panel.clickElement("button", "Запустить к точке");
  log("start_clicked", { chosen, previous_run_id: before.run_id ?? null });

  const startedAt = Date.now();
  const timeoutMs = Number(args.timeout ?? 240) * 1000;
  let stopClicked = false;
  let lastKey = "";
  let state = null;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1000);
    state = await readState();
    await capture();
    const key = `${state.status}/${state.navigation?.phase}/${state.navigation?.target_reached}`;
    if (key !== lastKey) {
      log("state", { status: state.status, run_id: state.run_id, phase: state.navigation?.phase,
        target_reached: state.navigation?.target_reached, last_error: state.last_error,
        battery: state.battery_remaining, simulation_time_s: state.simulation_time_s,
        current_goal: state.current_goal?.kind ?? null, planned_path_points: state.planned_path?.length ?? 0,
        route_revision: state.route_revision });
      await capture(`${state.status}-${state.navigation?.phase ?? "none"}`);
      lastKey = key;
    }
    if (state.run_id === before.run_id && Date.now() - startedAt > 8000) {
      log("no_new_run", { text: (await panel.bodyText()).slice(0, 1500) });
      break;
    }
    if (args["stop-after"] && !stopClicked && state.status === "running"
        && Date.now() - startedAt > Number(args["stop-after"]) * 1000) {
      await panel.clickElement("button", "Stop");
      stopClicked = true;
      log("stop_clicked", { phase: state.navigation?.phase });
    }
    if (TERMINAL.has(state.status) && state.run_id !== before.run_id) break;
  }
  await sleep(2000);
  await capture("final");
  log("final_text", { text: (await panel.bodyText()).slice(0, 2000) });
  writeFileSync(join(outDir, "final-state.json"), JSON.stringify(await readState(), null, 2));
  browser.close();
}

main().catch((error) => {
  log("driver_error", { message: String(error) });
  process.exit(1);
});
