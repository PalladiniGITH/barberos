const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function walkFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })

  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      return walkFiles(fullPath)
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      return [fullPath]
    }

    return []
  })
}

test('arquivos com use server exportam apenas funcoes async de runtime', () => {
  const actionsDirectory = path.join(process.cwd(), 'src', 'actions')
  const files = walkFiles(actionsDirectory)
  const offenders = []

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')

    if (!content.includes("'use server'") && !content.includes('"use server"')) {
      continue
    }

    const lines = content.split(/\r?\n/)

    lines.forEach((line, index) => {
      const trimmed = line.trim()

      if (!trimmed.startsWith('export ')) {
        return
      }

      if (/^export\s+async\s+function\b/.test(trimmed)) {
        return
      }

      if (/^export\s+type\b/.test(trimmed) || /^export\s+interface\b/.test(trimmed)) {
        return
      }

      offenders.push({
        file: path.relative(process.cwd(), file),
        line: index + 1,
        code: trimmed,
      })
    })
  }

  assert.deepEqual(offenders, [])
})
