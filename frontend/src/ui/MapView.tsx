import { useEffect, useRef, useState } from "react";
import type { MapData, MissionSnapshot, Point } from "../domain/contract";
import { canvasClickToWorld, cellAtWorld, createViewTransform } from "../domain/geometry";
import { formatCoordinate } from "../domain/navigationDraft";
import { isMapMismatch } from "../domain/presentation";
import { drawScene, MAP_COLORS } from "./mapRenderer";

interface MapViewProps {
  map: MapData | null;
  snapshot: MissionSnapshot | null;
  mapError: string | null;
  stale: boolean;
  /** Выбранная, но не отправленная точка навигации. */
  draftTarget?: Point | null;
  /** Выбор точки кликом; null — режим без навигации. lockedReason != null — клик объясняет, почему цель менять нельзя. */
  picker?: { lockedReason: string | null; onPick: (point: Point) => void } | null;
}

const LEGEND: ReadonlyArray<{ label: string; color: string; shape: "square" | "line" | "dashed" | "ring" }> = [
  { label: "Робот (острие — направление)", color: MAP_COLORS.robot, shape: "square" },
  { label: "База", color: MAP_COLORS.base, shape: "square" },
  { label: "Текущая подцель робота", color: MAP_COLORS.goal, shape: "ring" },
  { label: "Цель пользователя (круг — допуск прибытия)", color: MAP_COLORS.userTarget, shape: "ring" },
  { label: "Пройденная траектория", color: MAP_COLORS.trajectory, shape: "line" },
  { label: "Планируемый путь", color: MAP_COLORS.plannedPath, shape: "dashed" },
  { label: "Подтверждённый сбор", color: MAP_COLORS.collected, shape: "square" },
  { label: "Оценка грунта (оценка агента, не истина; ± — неопределённость)", color: MAP_COLORS.terrain, shape: "ring" },
  { label: "Наблюдаемая опасность (по событиям, граница неизвестна)", color: MAP_COLORS.hazard, shape: "ring" },
  { label: "Следующие шаги плана", color: MAP_COLORS.planStep, shape: "ring" },
  { label: "Второй робот команды и его бронь", color: MAP_COLORS.partner, shape: "square" },
  { label: "Препятствие", color: MAP_COLORS.obstacle, shape: "square" },
  { label: "Свободно", color: MAP_COLORS.free, shape: "square" },
  { label: "Неизвестно", color: MAP_COLORS.unknown, shape: "square" },
];

export function MapView({ map, snapshot, mapError, stale, draftTarget = null, picker = null }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const mismatch = isMapMismatch(snapshot, map);
  const drawable = map !== null && !mismatch;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || size.width === 0 || size.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!drawable) {
      context.clearRect(0, 0, size.width, size.height);
      return;
    }
    drawScene(context, size, { map, snapshot, draftTarget });
  }, [map, snapshot, size, drawable, draftTarget]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (picker === null) return;
    if (picker.lockedReason !== null) {
      setPickNotice(picker.lockedReason);
      return;
    }
    if (map === null || !drawable) {
      setPickNotice("Карта ещё не загружена или не совпадает с состоянием: точку выбрать нельзя.");
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const transform = createViewTransform(map, size);
    const world = canvasClickToWorld(transform, size, rect, { x: event.clientX, y: event.clientY });
    if (world === null || cellAtWorld(map, world) === null) {
      setPickNotice("Клик вне карты проигнорирован: выберите точку внутри карты.");
      return;
    }
    const rounded = {
      position_x_m: Number(formatCoordinate(world.position_x_m)),
      position_y_m: Number(formatCoordinate(world.position_y_m)),
    };
    setPickNotice(null);
    picker.onPick(rounded);
  };

  const description = describeScene(snapshot, drawable);
  let overlay: string | null = null;
  if (map === null) overlay = mapError ?? "Карта загружается…";
  else if (mismatch) overlay = `Версия карты не совпадает: состояние на «${snapshot?.map_id}», загружена «${map.map_id}». Загружаем подходящую…`;

  return (
    <section className="panel map-panel" aria-labelledby="map-title">
      <h2 id="map-title">Карта</h2>
      <div className={`map-canvas-wrap${stale ? " is-stale" : ""}`} ref={containerRef}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={description}
          data-testid="map-canvas"
          style={{ width: size.width, height: size.height, cursor: picker !== null && picker.lockedReason === null ? "crosshair" : "default" }}
          onClick={handleCanvasClick}
        />
        {overlay !== null && <p className="map-overlay" role="status">{overlay}</p>}
      </div>
      {picker !== null && (
        <p className="hint pick-hint" role="status" data-testid="pick-notice">
          {pickNotice ??
            (picker.lockedReason ??
              "Кликните по карте, чтобы выбрать точку: клик только выбирает её, робот не двигается. Координаты можно ввести числами в панели миссии.")}
        </p>
      )}
      <ul className="legend" aria-label="Легенда карты">
        {LEGEND.map((item) => (
          <li key={item.label}>
            <span className={`swatch swatch-${item.shape}`} style={{ "--swatch": item.color } as React.CSSProperties} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function describeScene(snapshot: MissionSnapshot | null, drawable: boolean): string {
  if (!drawable || snapshot === null) return "Карта недоступна";
  const pose = snapshot.robot_pose;
  const robot = pose === null ? "позиция робота неизвестна" : `робот в (${pose.position_x_m.toFixed(2)}; ${pose.position_y_m.toFixed(2)}) м`;
  return `Карта: ${robot}, подтверждённых сборов: ${snapshot.collected_samples.length}`;
}
