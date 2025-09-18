import { Fragment } from 'react'
import type { FC, ReactNode } from 'react'

type ClipDescriptionProps = {
  text: string
  className?: string
}

const tokenPattern = /(https?:\/\/[^\s]+|#[A-Za-z0-9_]+)/g

const appendTextWithLineBreaks = (
  content: ReactNode[],
  text: string,
  keyPrefix: string
): void => {
  if (!text) {
    return
  }

  const segments = text.split(/\n/)
  segments.forEach((segment, index) => {
    if (segment) {
      content.push(
        <span key={`${keyPrefix}-text-${index}`} className="whitespace-pre-wrap">
          {segment}
        </span>
      )
    }
    if (index < segments.length - 1) {
      content.push(<br key={`${keyPrefix}-br-${index}`} />)
    }
  })
}

const ClipDescription: FC<ClipDescriptionProps> = ({ text, className }) => {
  const nodes: ReactNode[] = []
  let cursor = 0
  let matchIndex = 0

  for (const match of text.matchAll(tokenPattern)) {
    if (typeof match.index !== 'number') {
      continue
    }

    if (match.index > cursor) {
      appendTextWithLineBreaks(nodes, text.slice(cursor, match.index), `pre-${matchIndex}`)
    }

    const token = match[0]
    if (token.startsWith('#')) {
      nodes.push(
        <strong key={`tag-${matchIndex}`} className="font-semibold text-[var(--fg)]">
          {token}
        </strong>
      )
    } else {
      nodes.push(
        <a
          key={`link-${matchIndex}`}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--ring)] underline decoration-transparent transition hover:decoration-inherit"
        >
          {token}
        </a>
      )
    }

    cursor = match.index + token.length
    matchIndex += 1
  }

  if (cursor < text.length) {
    appendTextWithLineBreaks(nodes, text.slice(cursor), `post-${matchIndex}`)
  }

  if (nodes.length === 0) {
    nodes.push(text)
  }

  return <p className={className}>{nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>)}</p>
}

export default ClipDescription
