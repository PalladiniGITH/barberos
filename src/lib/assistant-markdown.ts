export interface AssistantMarkdownTextToken {
  type: 'text'
  content: string
}

export interface AssistantMarkdownStrongToken {
  type: 'strong'
  content: string
}

export type AssistantMarkdownInlineToken =
  | AssistantMarkdownTextToken
  | AssistantMarkdownStrongToken

export interface AssistantMarkdownParagraphBlock {
  type: 'paragraph'
  lines: AssistantMarkdownInlineToken[][]
}

export interface AssistantMarkdownListBlock {
  type: 'unordered-list' | 'ordered-list'
  items: AssistantMarkdownInlineToken[][]
}

export type AssistantMarkdownBlock =
  | AssistantMarkdownParagraphBlock
  | AssistantMarkdownListBlock

function parseInlineMarkdown(text: string): AssistantMarkdownInlineToken[] {
  const tokens: AssistantMarkdownInlineToken[] = []
  const pattern = /\*\*(.+?)\*\*/g
  let cursor = 0

  while (true) {
    const match = pattern.exec(text)
    if (!match) {
      break
    }

    const raw = match[0]
    const content = match[1]
    const index = match.index ?? -1

    if (index < cursor) {
      continue
    }

    if (index > cursor) {
      tokens.push({
        type: 'text',
        content: text.slice(cursor, index),
      })
    }

    if (content.trim().length > 0) {
      tokens.push({
        type: 'strong',
        content,
      })
    } else {
      tokens.push({
        type: 'text',
        content: raw,
      })
    }

    cursor = index + raw.length
  }

  if (cursor < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(cursor),
    })
  }

  if (tokens.length === 0) {
    return [
      {
        type: 'text',
        content: text,
      },
    ]
  }

  return tokens
}

export function parseAssistantMarkdown(content: string): AssistantMarkdownBlock[] {
  const normalized = (content || '').replace(/\r\n/g, '\n').trim()

  if (!normalized) {
    return []
  }

  const lines = normalized.split('\n')
  const blocks: AssistantMarkdownBlock[] = []
  let paragraphLines: AssistantMarkdownInlineToken[][] = []
  let listType: AssistantMarkdownListBlock['type'] | null = null
  let listItems: AssistantMarkdownInlineToken[][] = []

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return
    }

    blocks.push({
      type: 'paragraph',
      lines: paragraphLines,
    })
    paragraphLines = []
  }

  function flushList() {
    if (!listType || listItems.length === 0) {
      return
    }

    blocks.push({
      type: listType,
      items: listItems,
    })
    listType = null
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    const unorderedMatch = line.match(/^-\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      if (listType !== 'unordered-list') {
        flushList()
        listType = 'unordered-list'
      }

      listItems.push(parseInlineMarkdown(unorderedMatch[1]))
      continue
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      if (listType !== 'ordered-list') {
        flushList()
        listType = 'ordered-list'
      }

      listItems.push(parseInlineMarkdown(orderedMatch[1]))
      continue
    }

    flushList()
    paragraphLines.push(parseInlineMarkdown(line))
  }

  flushParagraph()
  flushList()

  return blocks
}
