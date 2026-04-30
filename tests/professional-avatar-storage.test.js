const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildProfessionalAvatarPublicUrl,
  buildProfessionalAvatarRelativePath,
  detectProfessionalAvatarFileExtension,
  extractProfessionalAvatarRelativePath,
  getProfessionalAvatarExtensionFromMimeType,
  resolveProfessionalAvatarLocalFilePath,
  resolveProfessionalAvatarStorageConfig,
} = require('@/lib/professionals/avatar-storage')

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
