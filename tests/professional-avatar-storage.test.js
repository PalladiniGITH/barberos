const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  buildProfessionalAvatarPublicUrl,
  buildProfessionalAvatarRelativePath,
  detectProfessionalAvatarFileExtension,
  extractProfessionalAvatarRelativePath,
  getProfessionalAvatarExtensionFromMimeType,
  isUploadedFileLike,
  ProfessionalAvatarUploadError,
  resolveProfessionalAvatarLocalFilePath,
  resolveProfessionalAvatarStorageConfig,
  storeProfessionalAvatarFile,
} = require('@/lib/professionals/avatar-storage')

function createUploadedFileLike(input) {
  const buffer = input.buffer

  return {
    name: input.name ?? 'avatar.bin',
    type: input.type,
    size: buffer.length,
    async arrayBuffer() {
      const uint8Array = Uint8Array.from(buffer)
      return uint8Array.buffer.slice(
        uint8Array.byteOffset,
        uint8Array.byteOffset + uint8Array.byteLength
      )
    },
  }
}

test('detecta formatos permitidos por assinatura binaria', () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const jpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
  const webpBuffer = Buffer.from('RIFF1234WEBPVP8 ', 'ascii')
  const txtBuffer = Buffer.from('not-an-image', 'utf8')

  assert.equal(detectProfessionalAvatarFileExtension(pngBuffer), 'png')
  assert.equal(detectProfessionalAvatarFileExtension(jpgBuffer), 'jpg')
  assert.equal(detectProfessionalAvatarFileExtension(webpBuffer), 'webp')
  assert.equal(detectProfessionalAvatarFileExtension(txtBuffer), null)
})

test('mapeia mime type permitido para extensao de avatar', () => {
  assert.equal(getProfessionalAvatarExtensionFromMimeType('image/jpeg'), 'jpg')
  assert.equal(getProfessionalAvatarExtensionFromMimeType('image/png'), 'png')
  assert.equal(getProfessionalAvatarExtensionFromMimeType('image/webp'), 'webp')
  assert.equal(getProfessionalAvatarExtensionFromMimeType('application/pdf'), null)
})

test('reconhece arquivo estrutural sem depender de File global', () => {
  const uploadedFileLike = createUploadedFileLike({
    type: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    name: 'avatar.png',
  })

  assert.equal(isUploadedFileLike(uploadedFileLike), true)
  assert.equal(isUploadedFileLike('not-a-file'), false)
  assert.equal(isUploadedFileLike({ type: 'image/png', size: 20 }), false)
})

test('gera caminho isolado por tenant e profissional', () => {
  const relativePath = buildProfessionalAvatarRelativePath({
    barbershopId: 'cmbarber123',
    professionalId: 'cmprof456',
    extension: 'webp',
    randomToken: 'abc123',
  })

  assert.equal(
    relativePath,
    'professionals/cmbarber123/cmprof456-abc123.webp'
  )
})

test('monta URL publica relativa ou absoluta sem perder o path de uploads', () => {
  assert.equal(
    buildProfessionalAvatarPublicUrl('professionals/cmbarber123/cmprof456-abc123.webp', {
      UPLOAD_PUBLIC_BASE_URL: '/uploads',
    }),
    '/uploads/professionals/cmbarber123/cmprof456-abc123.webp'
  )

  assert.equal(
    buildProfessionalAvatarPublicUrl('professionals/cmbarber123/cmprof456-abc123.webp', {
      UPLOAD_PUBLIC_BASE_URL: 'https://media.barberex.com/uploads',
    }),
    'https://media.barberex.com/uploads/professionals/cmbarber123/cmprof456-abc123.webp'
  )
})

test('extrai caminho relativo apenas quando a URL pertence ao storage configurado', () => {
  const relativeEnv = { UPLOAD_PUBLIC_BASE_URL: '/uploads' }
  const absoluteEnv = { UPLOAD_PUBLIC_BASE_URL: 'https://media.barberex.com/uploads' }

  assert.equal(
    extractProfessionalAvatarRelativePath(
      '/uploads/professionals/cmbarber123/cmprof456-abc123.webp',
      relativeEnv
    ),
    'professionals/cmbarber123/cmprof456-abc123.webp'
  )

  assert.equal(
    extractProfessionalAvatarRelativePath(
      'https://media.barberex.com/uploads/professionals/cmbarber123/cmprof456-abc123.webp',
      absoluteEnv
    ),
    'professionals/cmbarber123/cmprof456-abc123.webp'
  )

  assert.equal(
    extractProfessionalAvatarRelativePath(
      'https://cdn.outrodominio.com/uploads/professionals/cmbarber123/cmprof456-abc123.webp',
      absoluteEnv
    ),
    null
  )
})

test('resolve diretorio local persistente para avatar sem sair da raiz configurada', () => {
  const config = resolveProfessionalAvatarStorageConfig({
    UPLOAD_LOCAL_DIR: path.join(process.cwd(), '.tmp', 'barberex-uploads'),
  })

  const localFilePath = resolveProfessionalAvatarLocalFilePath(
    'professionals/cmbarber123/cmprof456-abc123.webp',
    {
      UPLOAD_LOCAL_DIR: config.localDir,
    }
  )

  const relativeToRoot = path.relative(config.localDir, localFilePath)

  assert.equal(relativeToRoot, path.join('professionals', 'cmbarber123', 'cmprof456-abc123.webp'))
  assert.equal(relativeToRoot.startsWith('..'), false)
})

test('salva upload com objeto compativel sem depender de File global', async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barberex-avatar-'))
  const env = {
    UPLOAD_LOCAL_DIR: temporaryDir,
    UPLOAD_PUBLIC_BASE_URL: '/uploads',
    UPLOAD_MAX_FILE_SIZE_MB: '3',
  }
  const uploadedFileLike = createUploadedFileLike({
    type: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]),
    name: 'avatar.png',
  })

  try {
    const storedAvatar = await storeProfessionalAvatarFile({
      file: uploadedFileLike,
      barbershopId: 'cmbarber123',
      professionalId: 'cmprof456',
      env,
    })

    assert.match(
      storedAvatar.avatarUrl,
      /^\/uploads\/professionals\/cmbarber123\/cmprof456-[a-z0-9]+\.png$/
    )

    await fs.access(storedAvatar.localFilePath)
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true })
  }
})

test('rejeita upload com tipo invalido', async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barberex-avatar-'))
  const env = {
    UPLOAD_LOCAL_DIR: temporaryDir,
    UPLOAD_PUBLIC_BASE_URL: '/uploads',
    UPLOAD_MAX_FILE_SIZE_MB: '3',
  }
  const uploadedFileLike = createUploadedFileLike({
    type: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4', 'utf8'),
    name: 'avatar.pdf',
  })

  try {
    await storeProfessionalAvatarFile({
      file: uploadedFileLike,
      barbershopId: 'cmbarber123',
      professionalId: 'cmprof456',
      env,
    })
    assert.fail('Esperava erro para tipo de arquivo invalido.')
  } catch (error) {
    assert.equal(error?.name, 'ProfessionalAvatarUploadError')
    assert.equal(error?.statusCode, 415)
    assert.equal(error?.message, 'Envie apenas imagens JPG, PNG ou WEBP.')
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true })
  }
})

test('rejeita upload acima do limite configurado', async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barberex-avatar-'))
  const env = {
    UPLOAD_LOCAL_DIR: temporaryDir,
    UPLOAD_PUBLIC_BASE_URL: '/uploads',
    UPLOAD_MAX_FILE_SIZE_MB: '1',
  }
  const uploadedFileLike = {
    name: 'avatar.png',
    type: 'image/png',
    size: 2 * 1024 * 1024,
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }

  try {
    await storeProfessionalAvatarFile({
      file: uploadedFileLike,
      barbershopId: 'cmbarber123',
      professionalId: 'cmprof456',
      env,
    })
    assert.fail('Esperava erro para arquivo acima do limite.')
  } catch (error) {
    assert.equal(error?.name, 'ProfessionalAvatarUploadError')
    assert.equal(error?.statusCode, 413)
    assert.equal(error?.message, 'A foto deve ter no maximo 1MB.')
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true })
  }
})

test('rota de upload nao usa instanceof File', async () => {
  const routeSource = await fs.readFile(
    path.join(
      process.cwd(),
      'src',
      'app',
      'api',
      'professionals',
      '[professionalId]',
      'avatar',
      'route.ts'
    ),
    'utf8'
  )

  assert.equal(routeSource.includes('instanceof File'), false)
})
