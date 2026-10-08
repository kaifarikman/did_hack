interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

interface LabelSlot extends LabelBox {
  text: string
  color: string
}

const LABEL_LIMIT = 64
const OBSTACLE_LIMIT = 64
const PADDING_X = 6
const PADDING_Y = 2

function overlaps(first: LabelBox, second: LabelBox): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

function emptyBox(): LabelBox {
  return { x: 0, y: 0, width: 0, height: 0 }
}

export class LabelSink {
  private readonly slots: LabelSlot[] = Array.from({ length: LABEL_LIMIT }, () => ({
    ...emptyBox(),
    text: "",
    color: "",
  }))
  private readonly obstacles: LabelBox[] = Array.from({ length: OBSTACLE_LIMIT }, emptyBox)
  private readonly probe: LabelBox = emptyBox()
  private count = 0
  private obstacleCount = 0
  private lineHeight = 0
  private font = ""

  begin(context: CanvasRenderingContext2D, font: string): void {
    this.font = font
    this.count = 0
    this.obstacleCount = 0
    context.font = font
    const metrics = context.measureText("0")
    const ascent = metrics.actualBoundingBoxAscent || 0
    const descent = metrics.actualBoundingBoxDescent || 0
    this.lineHeight = ascent + descent + PADDING_Y * 2
  }

  get labelHeight(): number {
    return this.lineHeight
  }

  isFree(x: number, y: number, width: number, height: number): boolean {
    const probe = this.probe
    probe.x = x
    probe.y = y
    probe.width = width
    probe.height = height
    return !this.blocked(probe)
  }

  reserve(x: number, y: number, width: number, height: number): void {
    const box = this.obstacles[this.obstacleCount]
    if (box === undefined) return
    box.x = x
    box.y = y
    box.width = width
    box.height = height
    this.obstacleCount += 1
  }

  reserveAround(centerX: number, centerY: number, radius: number): void {
    this.reserve(centerX - radius, centerY - radius, radius * 2, radius * 2)
  }

  add(
    context: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    bottomY: number,
    color: string,
    alternateBottomY: number = bottomY,
  ): boolean {
    const slot = this.slots[this.count]
    if (slot === undefined) return false
    context.font = this.font
    const width = context.measureText(text).width + PADDING_X * 2
    slot.x = centerX - width / 2
    slot.width = width
    slot.height = this.lineHeight
    slot.text = text
    slot.color = color
    for (const candidate of [bottomY, alternateBottomY]) {
      slot.y = candidate - this.lineHeight
      if (!this.blocked(slot)) {
        this.count += 1
        return true
      }
    }
    return false
  }

  private blocked(candidate: LabelBox): boolean {
    for (let index = 0; index < this.obstacleCount; index += 1) {
      const other = this.obstacles[index]
      if (other !== undefined && overlaps(candidate, other)) return true
    }
    for (let index = 0; index < this.count; index += 1) {
      const other = this.slots[index]
      if (other !== undefined && other !== candidate && overlaps(candidate, other)) return true
    }
    return false
  }

  flush(context: CanvasRenderingContext2D, halo: string): void {
    context.font = this.font
    context.textAlign = "center"
    context.textBaseline = "middle"
    for (let index = 0; index < this.count; index += 1) {
      const slot = this.slots[index]
      if (slot === undefined) continue
      context.fillStyle = halo
      context.beginPath()
      context.roundRect(slot.x, slot.y, slot.width, slot.height, slot.height / 2)
      context.fill()
      context.fillStyle = slot.color
      context.fillText(slot.text, slot.x + slot.width / 2, slot.y + slot.height / 2)
    }
  }
}
