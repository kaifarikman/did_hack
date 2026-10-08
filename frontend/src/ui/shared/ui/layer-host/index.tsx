import { createContext, type ReactNode, useContext, useState } from "react"
import styles from "./styles.module.css"

const LayerHostContext = createContext<HTMLElement | null>(null)

export interface LayerHostProps {
  readonly children: ReactNode
}

export function LayerHost({ children }: LayerHostProps) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  return (
    <LayerHostContext value={host}>
      {children}
      <div ref={setHost} className={styles.host} data-layer-host="" />
    </LayerHostContext>
  )
}

export function useLayerHost(): HTMLElement {
  return useContext(LayerHostContext) ?? document.body
}

export function cssZoom(element: Element | null | undefined): number {
  const zoom = (element as { currentCSSZoom?: unknown } | null | undefined)?.currentCSSZoom
  return typeof zoom === "number" && zoom > 0 ? zoom : 1
}

export function matchZoom(layer: HTMLElement, source: Element | null | undefined): number {
  const zoom = cssZoom(source)
  layer.style.zoom = String(zoom / cssZoom(layer.parentElement))
  return zoom
}
