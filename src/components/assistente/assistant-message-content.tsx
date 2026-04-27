import { Fragment } from 'react'
import {
  parseAssistantMarkdown,
  type AssistantMarkdownBlock,
  type AssistantMarkdownInlineToken,
} from '@/lib/assistant-markdown'
import { cn } from '@/lib/utils'

function renderInlineTokens(tokens: AssistantMarkdownInlineToken[]) {
  return tokens.map((token, index) => {
    if (token.type === 'strong') {
      return (
        <strong key={`strong-${index}`} className="font-semibold text-slate-50">
          {token.content}
        </strong>
      )
    }

    return <Fragment key={`text-${index}`}>{token.content}</Fragment>
  })
}

function renderLineGroups(lines: AssistantMarkdownInlineToken[][]) {
  return lines.map((tokens, index) => (
    <Fragment key={`line-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInlineTokens(tokens)}
    </Fragment>
  ))
}

function renderBlock(block: AssistantMarkdownBlock, index: number) {
  if (block.type === 'paragraph') {
    return (
      <p key={`paragraph-${index}`} className="break-words text-[0.95rem] leading-7 text-current">
        {renderLineGroups(block.lines)}
      </p>
    )
  }

  const ListTag = block.type === 'ordered-list' ? 'ol' : 'ul'

  return (
    <ListTag
      key={`${block.type}-${index}`}
      className={cn(
        'space-y-2 pl-5 text-[0.95rem] leading-7 marker:text-violet-300',
        block.type === 'ordered-list' ? 'list-decimal' : 'list-disc'
      )}
    >
      {block.items.map((tokens, itemIndex) => (
        <li key={`item-${itemIndex}`} className="break-words pl-1">
          {renderInlineTokens(tokens)}
        </li>
      ))}
    </ListTag>
  )
}

export function AssistantMessageContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const blocks = parseAssistantMarkdown(content)

  if (blocks.length === 0) {
    return null
  }

  return (
    <div className={cn('mt-2 space-y-3.5 text-sm leading-7', className)}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  )
}
