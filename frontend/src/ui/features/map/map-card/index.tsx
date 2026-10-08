import { useMemo } from "react"
import type { MapData, MissionSnapshot } from "@/domain/contract"
import type { Message } from "@/domain/message"
import { isMapMismatch } from "@/domain/status"
import { useFormatters, useMessageText } from "@/ui/shared/i18n"
import { useLatched, useLoadingIndicator, usePresence } from "@/ui/shared/motion"
import { Card, EmptyState, Skeleton } from "@/ui/shared/ui"
import {
  createMapLabelText,
  describeSceneMessage,
  mapStateMessage,
  visibleLegend,
} from "../labels"
import { MapCanvas } from "../map-canvas"
import { MapLegend } from "../map-legend"
import { buildScene } from "../scene"
import styles from "./styles.module.css"

export interface MapCardProps {
  readonly map: MapData | null
  readonly snapshot: MissionSnapshot | null
  readonly mapError: Message | null
  readonly stale: boolean
  readonly motionIndex: number
}

export function MapCard({ map, snapshot, mapError, stale, motionIndex }: MapCardProps) {
  const text = useMessageText()
  const format = useFormatters()
  const labels = useMemo(() => createMapLabelText(text, format), [text, format])
  const mismatch = isMapMismatch(snapshot, map)
  const drawable = map !== null && !mismatch
  const state = mapStateMessage({
    map,
    snapshot,
    mapError: mapError === null ? null : text(mapError),
    mismatch,
  })
  const stateText = state === null ? null : text(state)
  const legend = useMemo(
    () => visibleLegend(buildScene(snapshot), drawable),
    [snapshot, drawable],
  )
  const loading = useLoadingIndicator({
    pending: snapshot === null && map === null,
    hasData: false,
  })
  const overlay = usePresence(stateText !== null)
  const overlayText = useLatched(stateText, stateText !== null)
  return (
    <Card
      as="section"
      level="top"
      motionIndex={motionIndex}
      className={styles.card}
      title={text({ key: "map:title" })}
    >
      <div
        className={styles.surface}
        data-stale={stale}
        data-state={drawable ? "ready" : "waiting"}
      >
        <MapCanvas
          map={drawable ? map : null}
          snapshot={snapshot}
          text={labels}
          label={text(describeSceneMessage(snapshot, drawable, format))}
        />
        {loading === "skeleton" && <Skeleton shape="block" className={styles.skeleton} />}
        {overlay.mounted && overlayText !== null && (
          <div
            className={styles.overlay}
            data-state={overlay.state}
            data-motion="fade"
            onAnimationEnd={overlay.onAnimationEnd}
          >
            <EmptyState icon="map" title={overlayText} />
          </div>
        )}
      </div>
      <MapLegend items={legend} />
    </Card>
  )
}
