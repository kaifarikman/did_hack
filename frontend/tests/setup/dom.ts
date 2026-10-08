import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"
import { i18n } from "@/ui/shared/i18n"
import { resetMotionEnvironment } from "./motionEnvironment"

afterEach(async () => {
  cleanup()
  resetMotionEnvironment()
  await i18n.changeLanguage("ru")
})
