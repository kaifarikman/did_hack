import type { TeamRobotView, TeamView } from "@/domain/contract"
import { BackendText, useFormatters, useMessageText } from "@/ui/shared/i18n"
import { Card, Meter, NoValue, StatusBadge } from "@/ui/shared/ui"
import { coordinationLabel, isTeamVisible, type TeamTone, teamBadge } from "../labels"
import styles from "./styles.module.css"

export interface TeamCardProps {
  readonly team: TeamView | null
  readonly batteryInitial: number
  readonly robotStatusLabel: (robot: TeamRobotView) => string
  readonly goalLabel: (robot: TeamRobotView) => string | null
  readonly motionIndex: number
}

const ROBOT_TONES: Readonly<Record<TeamRobotView["status"], TeamTone>> = {
  idle: "neutral",
  starting: "progress",
  running: "progress",
  returning: "progress",
  stopping: "attention",
  completed: "positive",
  stopped: "attention",
  failed: "critical",
}

export function TeamCard({
  team,
  batteryInitial,
  robotStatusLabel,
  goalLabel,
  motionIndex,
}: TeamCardProps) {
  const text = useMessageText()
  const format = useFormatters()
  if (!isTeamVisible(team)) return null
  const badge = teamBadge(team)
  return (
    <Card
      as="section"
      level="top"
      motionIndex={motionIndex}
      className={styles.card}
      title={text({ key: "team:title" })}
      actions={
        <StatusBadge tone={badge.tone} icon="team" swapKey={badge.swapKey}>
          {text({ key: badge.key })}
        </StatusBadge>
      }
    >
      <p className={styles.meta}>
        <span>{text({ key: coordinationLabel(team) })}</span>
        <span>{text({ key: "team:samples", params: { count: team.samples_collected } })}</span>
      </p>
      <div className={styles.robots}>
        {team.robots.map((robot, index) => {
          const lost = team.lost_robots.includes(robot.robot_id)
          const goal = goalLabel(robot)
          const reservation = robot.reservation
          return (
            <Card
              as="article"
              level="inner"
              key={robot.robot_id}
              className={styles.robot}
              data-robot={robot.robot_id}
              data-lost={lost}
              data-motion="fade"
              title={text({ key: "team:robot.name", params: { number: index + 1 } })}
              actions={
                <StatusBadge
                  tone={lost ? "critical" : ROBOT_TONES[robot.status]}
                  swapKey={lost ? "lost" : robot.status}
                >
                  {lost ? text({ key: "team:robot.lost" }) : robotStatusLabel(robot)}
                </StatusBadge>
              }
            >
              <Meter
                label={text({ key: "team:column.battery" })}
                value={
                  robot.battery_remaining === null
                    ? null
                    : Math.min(robot.battery_remaining / batteryInitial, 1)
                }
                valueText={
                  robot.battery_remaining === null
                    ? ""
                    : format.number(robot.battery_remaining, 1)
                }
              />
              <div className={styles.details}>
                <span>{goal ?? <NoValue />}</span>
                <span className={styles.reservation} data-reserved={reservation !== null}>
                  {reservation === null
                    ? text({ key: "team:robot.noReservation" })
                    : text({
                        key: "team:robot.reservation",
                        params: {
                          x: format.number(reservation.position_x_m, 2),
                          y: format.number(reservation.position_y_m, 2),
                        },
                      })}
                </span>
                {robot.last_error !== null && (
                  <BackendText>{robot.last_error.message}</BackendText>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </Card>
  )
}
