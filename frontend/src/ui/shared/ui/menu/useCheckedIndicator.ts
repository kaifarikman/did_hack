import { type RefObject, useLayoutEffect } from "react"

export const CHECKED_ITEM = '[aria-checked="true"]'

export function placeIndicator(menu: HTMLElement, indicator: HTMLElement): boolean {
  const checked = menu.querySelector<HTMLElement>(CHECKED_ITEM)
  if (checked === null) {
    menu.dataset.indicator = "hidden"
    return false
  }
  if (menu.dataset.indicator !== "ready") menu.dataset.indicator = "placed"
  indicator.style.transform = `translateY(${checked.offsetTop}px)`
  indicator.style.blockSize = `${checked.offsetHeight}px`
  return true
}

export function useCheckedIndicator(
  menuRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const menu = menuRef.current
    const indicator = indicatorRef.current
    if (!active || menu === null || indicator === null) return
    if (!placeIndicator(menu, indicator) || menu.dataset.indicator === "ready") return
    const frame = requestAnimationFrame(() => {
      menu.dataset.indicator = "ready"
    })
    return () => cancelAnimationFrame(frame)
  })
}
