import type { Point } from "@/domain/contract"
import { circle, type LayerFrame, screenX, screenY } from "./frame"

function targetMark(frame: LayerFrame, point: Point, draft: boolean): void {
  const { context, transform, palette } = frame
  const horizontal = screenX(transform, point),
    vertical = screenY(transform, point)
  context.save()
  context.strokeStyle = palette.css.goal
  context.lineWidth = 2
  context.setLineDash(draft ? [4, 4] : [])
  circle(context, horizontal, vertical, draft ? 14 : 18)
  context.stroke()
  context.beginPath()
  context.moveTo(horizontal - 6, vertical)
  context.lineTo(horizontal + 6, vertical)
  context.moveTo(horizontal, vertical - 6)
  context.lineTo(horizontal, vertical + 6)
  context.stroke()
  context.restore()
}
export function drawNavigation(frame: LayerFrame): void {
  if (frame.scene.userTarget != null) targetMark(frame, frame.scene.userTarget, false)
  if (frame.scene.draftTarget != null) targetMark(frame, frame.scene.draftTarget, true)
}
