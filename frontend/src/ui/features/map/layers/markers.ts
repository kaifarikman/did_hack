import { circle, type LayerFrame, screenX, screenY } from "./frame"

const BASE_HALF_SIZE = 8
const BASE_INNER_HALF_SIZE = 3
const STEP_RADIUS = 12
const STEP_SPACING = 2 * STEP_RADIUS + 4
const GOAL_RADIUS = 9
const GOAL_DOT_RADIUS = 2.5
const ROBOT_RADIUS = 18
const MARK_MARGIN = 3
const OUTLINE_WIDTH = 2
const LEADER_WIDTH = 1.5
const GOAL_WIDTH = 3
const STEP_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [0, -1.5],
  [0, 1.5],
]

interface StepMark {
  readonly number: number
  readonly targetX: number
  readonly targetY: number
  readonly x: number
  readonly y: number
  readonly moved: boolean
}

function reserveFixedMarks(frame: LayerFrame): void {
  const { transform, scene, labels, motion } = frame
  if (scene.base !== null)
    labels.reserveAround(
      screenX(transform, scene.base),
      screenY(transform, scene.base),
      BASE_HALF_SIZE + MARK_MARGIN,
    )
  if (scene.goal !== null)
    labels.reserveAround(
      screenX(transform, scene.goal),
      screenY(transform, scene.goal),
      GOAL_RADIUS + MARK_MARGIN,
    )
  for (const robot of scene.robots) {
    const pose = motion.pose(robot.id)
    if (pose !== null)
      labels.reserveAround(screenX(transform, pose), screenY(transform, pose), ROBOT_RADIUS)
  }
}

export function placeMarks(frame: LayerFrame): StepMark[] {
  const { transform, scene, labels } = frame
  reserveFixedMarks(frame)
  const marks: StepMark[] = []
  const side = STEP_RADIUS + MARK_MARGIN
  for (const step of scene.planSteps) {
    const targetX = screenX(transform, step.target)
    const targetY = screenY(transform, step.target)
    const offset =
      STEP_OFFSETS.find(([dx, dy]) =>
        labels.isFree(
          targetX + dx * STEP_SPACING - side,
          targetY + dy * STEP_SPACING - side,
          side * 2,
          side * 2,
        ),
      ) ?? STEP_OFFSETS[0]
    const [dx, dy] = offset ?? [0, 0]
    const x = targetX + dx * STEP_SPACING
    const y = targetY + dy * STEP_SPACING
    labels.reserveAround(x, y, side)
    marks.push({ number: step.number, targetX, targetY, x, y, moved: dx !== 0 || dy !== 0 })
  }
  return marks
}

export function drawBase(frame: LayerFrame): void {
  const { context, transform, palette, scene } = frame
  if (scene.base === null) return
  const x = screenX(transform, scene.base)
  const y = screenY(transform, scene.base)
  context.fillStyle = palette.css.base
  context.fillRect(
    x - BASE_HALF_SIZE,
    y - BASE_HALF_SIZE,
    BASE_HALF_SIZE * 2,
    BASE_HALF_SIZE * 2,
  )
  context.fillStyle = palette.css.labelHalo
  context.fillRect(
    x - BASE_INNER_HALF_SIZE,
    y - BASE_INNER_HALF_SIZE,
    BASE_INNER_HALF_SIZE * 2,
    BASE_INNER_HALF_SIZE * 2,
  )
}

export function drawPlanSteps(
  frame: LayerFrame,
  font: string,
  marks: readonly StepMark[],
): void {
  const { context, palette } = frame
  context.font = font
  context.textAlign = "center"
  context.textBaseline = "middle"
  for (const mark of marks) {
    if (mark.moved) {
      context.beginPath()
      context.moveTo(mark.targetX, mark.targetY)
      context.lineTo(mark.x, mark.y)
      context.strokeStyle = palette.css.planStep
      context.lineWidth = LEADER_WIDTH
      context.stroke()
      circle(context, mark.targetX, mark.targetY, OUTLINE_WIDTH)
      context.fillStyle = palette.css.planStep
      context.fill()
    }
    circle(context, mark.x, mark.y, STEP_RADIUS)
    context.fillStyle = palette.css.labelHalo
    context.fill()
    context.strokeStyle = palette.css.planStep
    context.lineWidth = OUTLINE_WIDTH
    context.stroke()
    context.fillStyle = palette.css.label
    context.fillText(String(mark.number), mark.x, mark.y)
  }
}

export function drawGoal(frame: LayerFrame): void {
  const { context, transform, palette, scene } = frame
  if (scene.goal === null) return
  const x = screenX(transform, scene.goal)
  const y = screenY(transform, scene.goal)
  circle(context, x, y, GOAL_RADIUS)
  context.strokeStyle = palette.css.goal
  context.lineWidth = GOAL_WIDTH
  context.stroke()
  circle(context, x, y, GOAL_DOT_RADIUS)
  context.fillStyle = palette.css.goal
  context.fill()
}
