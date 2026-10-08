import { clsx } from "clsx"
import { type ReactNode, type RefObject, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { usePresence } from "../../motion"
import { useLayerHost } from "../layer-host"
import styles from "./styles.module.css"
import { type Placement, useAnchorPosition } from "./useAnchorPosition"

export interface PopoverProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly anchorRef: RefObject<HTMLElement | null>
  readonly placement?: Placement | undefined
  readonly matchAnchorWidth?: boolean | undefined
  readonly instant?: boolean | undefined
  readonly id?: string | undefined
  readonly className?: string | undefined
  readonly children: ReactNode
}

function useDismiss(
  open: boolean,
  onClose: () => void,
  anchorRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target === null) return
      if (layerRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      onClose()
      anchorRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, onClose, anchorRef, layerRef])
}

export function Popover({
  open,
  onClose,
  anchorRef,
  placement = "bottom-start",
  matchAnchorWidth = false,
  instant = false,
  id,
  className,
  children,
}: PopoverProps) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const host = useLayerHost()
  const presence = usePresence(open, "--dur-fast-exit", instant)
  const side = useAnchorPosition(
    anchorRef,
    layerRef,
    presence.mounted,
    placement,
    matchAnchorWidth,
  )
  useDismiss(open, onClose, anchorRef, layerRef)
  if (!presence.mounted) return null
  return createPortal(
    <div
      ref={layerRef}
      id={id}
      className={clsx(styles.popover, className)}
      data-state={presence.state}
      data-instant={instant}
      data-side={side}
      data-align={placement.endsWith("end") ? "end" : "start"}
      data-motion="fade"
      onTransitionEnd={presence.onTransitionEnd}
    >
      {children}
    </div>,
    host,
  )
}

export { layoutLayer, type Placement, type Side } from "./useAnchorPosition"
export { type ListItemInfo, type ListNavigation, useListNavigation } from "./useListNavigation"
