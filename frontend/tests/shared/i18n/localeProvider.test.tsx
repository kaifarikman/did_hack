import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  createI18n,
  LOCALE_STORAGE_KEY,
  LocaleProvider,
  useLocale,
  useTranslation,
} from "@/ui/shared/i18n"
import en from "@/ui/shared/i18n/locales/en/common.json"
import ru from "@/ui/shared/i18n/locales/ru/common.json"

function Probe() {
  const { t } = useTranslation()
  const { locale, setLocale } = useLocale()
  return (
    <button type="button" data-locale={locale} onClick={() => setLocale("en")}>
      {t("action.close")}
    </button>
  )
}

describe("LocaleProvider", () => {
  afterEach(() => localStorage.clear())

  it("renders russian by default and sets the document language", () => {
    render(
      <LocaleProvider instance={createI18n()}>
        <Probe />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button").textContent).toBe(ru.action.close)
    expect(document.documentElement.lang).toBe("ru")
    expect(document.title).toBe(ru.app.title)
  })

  it("translates the document title with the interface", async () => {
    render(
      <LocaleProvider instance={createI18n()}>
        <Probe />
      </LocaleProvider>,
    )
    await act(async () => screen.getByRole("button").click())
    expect(document.title).toBe(en.app.title)
  })

  it("switches language, stores the choice and updates lang", async () => {
    render(
      <LocaleProvider instance={createI18n()}>
        <Probe />
      </LocaleProvider>,
    )
    await act(async () => screen.getByRole("button").click())
    expect(screen.getByRole("button").textContent).toBe(en.action.close)
    expect(screen.getByRole("button").dataset.locale).toBe("en")
    expect(document.documentElement.lang).toBe("en")
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en")
  })

  it("restores the stored locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en")
    render(
      <LocaleProvider instance={createI18n()}>
        <Probe />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button").textContent).toBe(en.action.close)
  })

  it("ignores an unknown stored locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "de")
    render(
      <LocaleProvider instance={createI18n()}>
        <Probe />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button").dataset.locale).toBe("ru")
  })
})
