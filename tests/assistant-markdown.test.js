const test = require('node:test')
const assert = require('node:assert/strict')

const { parseAssistantMarkdown } = require('@/lib/assistant-markdown')

test('transforma negrito em token strong dentro de paragrafos', () => {
  const blocks = parseAssistantMarkdown('Priorize **Caixa e meta** hoje.')

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'paragraph')
  assert.deepEqual(
    blocks[0].lines[0].map((token) => [token.type, token.content]),
    [
      ['text', 'Priorize '],
      ['strong', 'Caixa e meta'],
      ['text', ' hoje.'],
    ]
  )
})

test('agrupa listas numeradas e com bullets em blocos separados', () => {
  const blocks = parseAssistantMarkdown([
    '1. **Caixa e meta**',
    '- Faltam **R$ 8.191,35** para bater a meta.',
    '- Preencha horarios ociosos amanha.',
  ].join('\n'))

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'ordered-list')
  assert.equal(blocks[1].type, 'unordered-list')
  assert.deepEqual(
    blocks[0].items[0].map((token) => [token.type, token.content]),
    [['strong', 'Caixa e meta']]
  )
  assert.deepEqual(
    blocks[1].items[0].map((token) => [token.type, token.content]),
    [
      ['text', 'Faltam '],
      ['strong', 'R$ 8.191,35'],
      ['text', ' para bater a meta.'],
    ]
  )
})

test('mantem html bruto como texto seguro em vez de interpretar markup', () => {
  const blocks = parseAssistantMarkdown('<script>alert(1)</script>\n**ok**')

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'paragraph')
  assert.deepEqual(
    blocks[0].lines[0].map((token) => [token.type, token.content]),
    [['text', '<script>alert(1)</script>']]
  )
  assert.deepEqual(
    blocks[0].lines[1].map((token) => [token.type, token.content]),
    [['strong', 'ok']]
  )
})
