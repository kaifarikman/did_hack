import type { RobotPose } from "@/domain/contract"

const MOVE_EPSILON_M = 0.005
const TURN_EPSILON_RAD = 0.02
const HOLD_PULSES = 2

interface ScanTrack {
  x: number
  y: number
  heading: number
  movedAt: number
}

export class ScanClock {
  private readonly tracks = new Map<string, ScanTrack>()
  private periodMs = 0
  private travelMs = 0

  setTimings(periodMs: number, travelMs: number): void {
    this.periodMs = periodMs
    this.travelMs = travelMs
  }

  clear(): void {
    this.tracks.clear()
  }

  note(robotId: string, pose: RobotPose | null, now: number): void {
    if (pose === null) {
      this.tracks.delete(robotId)
      return
    }
    const track = this.tracks.get(robotId)
    if (track === undefined) {
      this.tracks.set(robotId, {
        x: pose.position_x_m,
        y: pose.position_y_m,
        heading: pose.heading_rad,
        movedAt: Number.NEGATIVE_INFINITY,
      })
      return
    }
    const moved =
      Math.abs(pose.position_x_m - track.x) > MOVE_EPSILON_M ||
      Math.abs(pose.position_y_m - track.y) > MOVE_EPSILON_M ||
      Math.abs(pose.heading_rad - track.heading) > TURN_EPSILON_RAD
    track.x = pose.position_x_m
    track.y = pose.position_y_m
    track.heading = pose.heading_rad
    if (moved) track.movedAt = now
  }

  pulse(robotId: string, now: number): number {
    if (this.periodMs <= 0 || this.travelMs <= 0) return -1
    const track = this.tracks.get(robotId)
    if (track === undefined) return -1
    const phase = now % this.periodMs
    const pulseStart = now - phase
    if (pulseStart > track.movedAt + this.periodMs * HOLD_PULSES) return -1
    return phase < this.travelMs ? phase / this.travelMs : -1
  }

  active(now: number): boolean {
    if (this.periodMs <= 0 || this.travelMs <= 0) return false
    const hold = this.periodMs * HOLD_PULSES
    const phase = now % this.periodMs
    const pulseStart = now - phase
    for (const track of this.tracks.values()) {
      if (now <= track.movedAt + hold) return true
      if (phase < this.travelMs && pulseStart <= track.movedAt + hold) return true
    }
    return false
  }
}
