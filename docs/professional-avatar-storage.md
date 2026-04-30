# Upload de avatar de profissionais

## Arquitetura adotada

- O app principal recebe o upload em `POST /api/professionals/:professionalId/avatar`.
- A rota exige sessao autenticada e bloqueia usuarios com role `BARBER`.
- O tenant atual sempre valida `professional.barbershopId === session.user.barbershopId`.
- O banco continua gravando apenas `Professional.avatar`, com o caminho publico final.
- O arquivo binario fica fora do app em um diretorio persistente configurado por `UPLOAD_LOCAL_DIR`.

## Variaveis de ambiente

```env
UPLOAD_STORAGE_DRIVER=local
UPLOAD_PUBLIC_BASE_URL=/uploads
UPLOAD_LOCAL_DIR=/data/barberex-uploads
UPLOAD_MAX_FILE_SIZE_MB=3
```

### Recomendacao para producao

- `UPLOAD_LOCAL_DIR` deve apontar para um volume persistente montado no container web.
- `UPLOAD_PUBLIC_BASE_URL` deve apontar para a raiz publica desse mesmo volume.
- Se usar um dominio dedicado de midia, prefira incluir o path `/uploads` na base publica.

Exemplo:

```env
UPLOAD_PUBLIC_BASE_URL=https://media.meubarberex.com.br/uploads
UPLOAD_LOCAL_DIR=/data/barberex-uploads
```

## Easypanel / Docker

### App web

- Monte um volume persistente em `/data/barberex-uploads`.
- O container da aplicacao precisa de permissao de escrita nesse volume.

### Container de midia sugerido

Servico sugerido:

- Nome: `barberex_media`
- Imagem: `nginx:alpine`
- Volume: `barberex_uploads:/usr/share/nginx/html/uploads:ro`

Esse container:

- so le os arquivos
- nao recebe upload direto
- nao acessa banco
- nao precisa de secrets do app

### Duas formas de exposicao

1. Dominio dedicado

- Exemplo: `https://media.meubarberex.com.br/uploads/...`
- Configure `UPLOAD_PUBLIC_BASE_URL=https://media.meubarberex.com.br/uploads`

2. Proxy no mesmo dominio principal

- Exemplo: `https://meubarberex.com.br/uploads/...`
- Configure `UPLOAD_PUBLIC_BASE_URL=/uploads`
- O proxy reverso deve encaminhar `/uploads` para o container `barberex_media`

## Validacoes aplicadas

- Auth obrigatoria
- isolamento por tenant
- bloqueio de role `BARBER`
- MIME aceito: `image/jpeg`, `image/png`, `image/webp`
- SVG, GIF, PDF e outros formatos sao rejeitados
- limite de tamanho configuravel, com padrao de 3MB
- nome aleatorio, sem usar o filename original
- path traversal bloqueado

## Serving local atual

Enquanto o proxy/container de midia nao estiver separado, o app tambem expõe:

- `GET /uploads/professionals/:barbershopId/:fileName`

Essa rota le o volume configurado e responde com `Cache-Control: immutable`, para que o sistema funcione ja nesta fase sem mudar o schema nem o valor salvo em `Professional.avatar`.

## Migracao futura para S3 / R2 / Supabase Storage

Para migrar depois:

1. Criar um novo driver de storage sem alterar o schema.
2. Fazer o upload gerar URL publica absoluta do bucket.
3. Manter `Professional.avatar` como string.
4. Desligar o route serving local quando toda a base estiver no bucket.
5. Opcionalmente criar uma rotina de migracao dos arquivos do volume local para o storage externo.
