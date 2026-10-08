import type { HealthStatus } from "../../../domain/contract"
import { READY_HEALTH, scriptOf } from "../baseline"
import type { FixtureScript } from "../script"
import { standardMission } from "../standardMission"

const BOOTING: HealthStatus = {
  status: "starting",
  ros_connected: false,
  judge_mode: "local",
  llm_available: false,
  supported_scenarios: ["easy"],
  supported_map_modes: ["static"],
  supported_task_types: ["research", "navigation"],
  supported_robot_counts: [1],
}
const ROS_UP: HealthStatus = { ...BOOTING, ros_connected: true }
const READY_WITHOUT_LLM: HealthStatus = { ...READY_HEALTH, llm_available: false }
const BOOTING_POLLS = 5
const ROS_UP_POLLS = 3

export function buildEnvStarting(): FixtureScript {
  const mission = standardMission({ llmFailsAtFrame: 1 })
  return scriptOf(mission.frames, mission.journal, {
    health: [
      ...Array.from({ length: BOOTING_POLLS }, () => BOOTING),
      ...Array.from({ length: ROS_UP_POLLS }, () => ROS_UP),
      READY_WITHOUT_LLM,
    ],
  })
}
