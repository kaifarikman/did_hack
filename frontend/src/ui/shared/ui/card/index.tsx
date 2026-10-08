import { clsx } from "clsx"
import { type HTMLAttributes, type ReactNode, useId } from "react"
import { staggerStyle } from "../../motion"
import { Eyebrow } from "../eyebrow"
import styles from "./styles.module.css"

export type CardLevel = "top" | "inner"
export type CardTone = "default" | "inverse"

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly level?: CardLevel
  readonly tone?: CardTone
  readonly as?: "section" | "article" | "aside" | "div"
  readonly motionIndex?: number | undefined
  readonly title?: ReactNode
  readonly eyebrow?: ReactNode
  readonly actions?: ReactNode
  readonly titleId?: string | undefined
  readonly children: ReactNode
}

interface CardHeaderProps {
  readonly level: CardLevel
  readonly tone: CardTone
  readonly titleId: string
  readonly title: ReactNode
  readonly eyebrow: ReactNode
  readonly actions: ReactNode
}

function CardHeader({ level, tone, titleId, title, eyebrow, actions }: CardHeaderProps) {
  const Heading = level === "top" ? "h2" : "h3"
  return (
    <header className={styles.header}>
      <hgroup className={styles.heading}>
        {eyebrow !== undefined && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
      </hgroup>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}

export function Card({
  level = "top",
  tone = "default",
  as: Tag = "section",
  motionIndex,
  title,
  eyebrow,
  actions,
  titleId,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const generatedId = useId()
  const headingId = titleId ?? generatedId
  const titled = title !== undefined
  const entering = motionIndex !== undefined
  const labelled = titled && rest["aria-label"] === undefined
  return (
    <Tag
      aria-labelledby={labelled ? headingId : undefined}
      {...rest}
      className={clsx(
        styles.card,
        titled && styles.titled,
        level === "inner" && styles.inner,
        tone === "inverse" && styles.inverse,
        entering && styles.entering,
        className,
      )}
      style={entering ? { ...style, ...staggerStyle(motionIndex) } : style}
      data-level={level}
      data-motion={entering ? "fade" : undefined}
    >
      {titled && (
        <CardHeader
          level={level}
          tone={tone}
          titleId={headingId}
          title={title}
          eyebrow={eyebrow}
          actions={actions}
        />
      )}
      {children}
    </Tag>
  )
}
