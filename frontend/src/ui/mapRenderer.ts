import type { MapData, MissionSnapshot, Point } from "../domain/contract";
import {
  createViewTransform,
  headingToScreenAngle,
  localToScreenMatrix,
  worldToScreen,
  type ViewTransform,
  type Viewport,
} from "../domain/geometry";

export const MAP_COLORS = {
  free: "#f4f1ea",
  obstacle: "#2f3a4a",
  unknown: "#c9ccd1",
  trajectory: "#2a7de1",
  plannedPath: "#d9660a",
  base: "#1b7f4c",
  robot: "#c0262d",
  goal: "#7b3fb8",
  collected: "#b8860b",
  terrain: "#0f8b8d",
} as const;

const mapImageCache = new WeakMap<MapData, HTMLCanvasElement>();

function cellColor(value: number): [number, number, number] {
  if (value === 100) return [0x2f, 0x3a, 0x4a];
  if (value === 0) return [0xf4, 0xf1, 0xea];
  return [0xc9, 0xcc, 0xd1];
}

/** Одна клетка = один пиксель; растр кэшируется на карту и масштабируется при рисовании. */
function mapImage(map: MapData): HTMLCanvasElement {
  const cached = mapImageCache.get(map);
  if (cached !== undefined) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const image = context.createImageData(map.width, map.height);
    map.cells.forEach((value, index) => {
      const [red, green, blue] = cellColor(value);
      image.data.set([red, green, blue, 255], index * 4);
    });
    context.putImageData(image, 0, 0);
  }
  mapImageCache.set(map, canvas);
  return canvas;
}

export interface Scene {
  map: MapData;
  snapshot: MissionSnapshot | null;
}

function tracePath(context: CanvasRenderingContext2D, transform: ViewTransform, points: Point[]): void {
  context.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(transform, point);
    if (index === 0) context.moveTo(screen.x, screen.y);
    else context.lineTo(screen.x, screen.y);
  });
}

export function drawScene(context: CanvasRenderingContext2D, viewport: Viewport, scene: Scene): ViewTransform {
  const { map, snapshot } = scene;
  const transform = createViewTransform(map, viewport);
  context.clearRect(0, 0, viewport.width, viewport.height);

  // карта: локальные метры → экран (с поворотом origin и перевёрнутой осью Y)
  const matrix = localToScreenMatrix(transform, map.origin);
  context.save();
  context.transform( // поверх текущего масштаба canvas (devicePixelRatio), а не вместо него
    matrix.a * map.resolution_m,
    matrix.b * map.resolution_m,
    matrix.c * map.resolution_m,
    matrix.d * map.resolution_m,
    matrix.e,
    matrix.f,
  );
  context.imageSmoothingEnabled = false;
  context.drawImage(mapImage(map), 0, 0, map.width, map.height);
  context.restore();

  if (snapshot === null) return transform;

  for (const estimate of snapshot.terrain_estimates) {
    const center = worldToScreen(transform, estimate.center);
    const radius = estimate.radius_m * transform.scale;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(15, 139, 141, ${0.12 + 0.25 * estimate.confidence})`;
    context.fill();
    context.setLineDash([4, 3]);
    context.strokeStyle = MAP_COLORS.terrain;
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = MAP_COLORS.terrain;
    context.font = "600 11px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(
      `оценка ${estimate.energy_per_m.toFixed(1)}/м · conf ${estimate.confidence.toFixed(2)}`,
      center.x,
      center.y - radius - 4,
    );
  }

  if (snapshot.trajectory.length > 1) {
    tracePath(context, transform, snapshot.trajectory);
    context.strokeStyle = MAP_COLORS.trajectory;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.stroke();
  }

  if (snapshot.planned_path.length > 1) {
    tracePath(context, transform, snapshot.planned_path);
    context.setLineDash([7, 5]);
    context.strokeStyle = MAP_COLORS.plannedPath;
    context.lineWidth = 2.5;
    context.stroke();
    context.setLineDash([]);
  }

  if (snapshot.base_position !== null) {
    const base = worldToScreen(transform, snapshot.base_position);
    context.fillStyle = MAP_COLORS.base;
    context.fillRect(base.x - 8, base.y - 8, 16, 16);
    context.fillStyle = "#ffffff";
    context.font = "700 11px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("Б", base.x, base.y + 4);
  }

  for (const sample of snapshot.collected_samples) {
    const place = worldToScreen(transform, sample.position);
    context.beginPath();
    context.moveTo(place.x, place.y - 9);
    context.lineTo(place.x + 8, place.y);
    context.lineTo(place.x, place.y + 9);
    context.lineTo(place.x - 8, place.y);
    context.closePath();
    context.fillStyle = MAP_COLORS.collected;
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.stroke();
  }

  const target = snapshot.current_goal?.target ?? null;
  if (target !== null) {
    const screen = worldToScreen(transform, target);
    context.beginPath();
    context.arc(screen.x, screen.y, 9, 0, Math.PI * 2);
    context.strokeStyle = MAP_COLORS.goal;
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.arc(screen.x, screen.y, 2.5, 0, Math.PI * 2);
    context.fillStyle = MAP_COLORS.goal;
    context.fill();
  }

  // отсутствие позиции — робота нет на карте, а не «в нуле»
  if (snapshot.robot_pose !== null) {
    const robot = worldToScreen(transform, snapshot.robot_pose);
    context.save();
    context.translate(robot.x, robot.y);
    context.rotate(headingToScreenAngle(snapshot.robot_pose.heading_rad));
    context.beginPath();
    context.moveTo(12, 0);
    context.lineTo(-8, 8);
    context.lineTo(-4, 0);
    context.lineTo(-8, -8);
    context.closePath();
    context.fillStyle = MAP_COLORS.robot;
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }
  return transform;
}
