# Backup e restore do PostgreSQL

## Abordagem adotada

Para o ambiente atual da VPS/EasyPanel, a estrategia mais confiavel e:

1. `cron` no host da VPS
2. `docker exec` no container do PostgreSQL
3. dumps em formato custom do `pg_dump`
4. backups gravados em diretorio persistente do host

Motivo:

- nao depende do container da aplicacao estar saudavel
- usa `pg_dump` e `pg_restore` nativos da imagem oficial do PostgreSQL
- funciona bem com o hostname interno atual do banco
- evita instalar cliente PostgreSQL extra dentro do app

## Arquivos principais

- `scripts/postgres-backup.mjs`
- `scripts/postgres-restore.mjs`
- `scripts/install-postgres-backup-cron.mjs`

## Variaveis de ambiente

Adicionar no ambiente da VPS quando quiser customizar:

```env
POSTGRES_BACKUP_DIR="/var/backups/barbermain/postgres"
POSTGRES_BACKUP_RETENTION_DAILY="7"
POSTGRES_BACKUP_CRON_HOUR="3"
POSTGRES_BACKUP_CRON_MINUTE="15"
POSTGRES_BACKUP_TIMEZONE="America/Sao_Paulo"
POSTGRES_BACKUP_CONTAINER="barberos_barberos-postgres"
```

Observacoes:

- `POSTGRES_BACKUP_CONTAINER` continua opcional e, quando definido, tem prioridade total.
- esse valor pode ser o nome exato do container ou um hint estavel, como o nome do servico `barberos_barberos-postgres`.
- se a variavel ficar vazia, o script tenta descobrir o container automaticamente a partir do host do `DATABASE_URL`, nomes/prefixos de containers, labels do Swarm/Compose e aliases de rede.
- se nada for definido, o projeto usa `/var/backups/barbermain/postgres` no Linux.

## Onde os backups ficam

Por padrao:

```bash
/var/backups/barbermain/postgres/
```

Estrutura:

```text
/var/backups/barbermain/postgres/
  daily/
    barberos_YYYYMMDD-HHMMSS.dump
    barberos_YYYYMMDD-HHMMSS.dump.sha256
    barberos_YYYYMMDD-HHMMSS.dump.json
  weekly/
  logs/
    postgres-backup.log
```

Hoje a retencao automatica vale para `daily/`:

- mantem os ultimos 7 backups diarios

A pasta `weekly/` ja fica preparada para evolucao futura.

## Como instalar o agendamento diario

No host da VPS:

```bash
cd /caminho/do/projeto
sudo node scripts/install-postgres-backup-cron.mjs
```

Isso cria um cron em:

```bash
/etc/cron.d/barbermain-postgres-backup
```

Horario padrao:

- todos os dias as 03:15
- timezone `America/Sao_Paulo`

## Como rodar um backup manual

Teste inicial recomendado:

```bash
node scripts/postgres-backup.mjs
```

Logs esperados:

- `[db-backup] starting`
- `[db-backup] completed`

## Como restaurar um backup

### Restore sobre o banco atual

```bash
node scripts/postgres-restore.mjs \
  --file /var/backups/barbermain/postgres/daily/barberos_YYYYMMDD-HHMMSS.dump \
  --force
```

### Restore em banco limpo

```bash
node scripts/postgres-restore.mjs \
  --file /var/backups/barbermain/postgres/daily/barberos_YYYYMMDD-HHMMSS.dump \
  --target-db barberos_restore_test \
  --drop-create \
  --force
```

O script:

- recria o banco alvo quando `--drop-create` e usado
- roda `pg_restore`
- valida se existem tabelas publicas apos o restore

## Como validar que o restore funcionou

Fluxo recomendado de teste:

1. rodar um backup manual
2. restaurar em um banco separado, por exemplo `barberos_restore_test`
3. confirmar nos logs do restore o campo `publicTableCount`
4. conectar no banco restaurado e validar tabelas e volume basico de dados

Exemplo de validacao adicional:

```bash
docker exec -it barberos_barberos-postgres psql -U postgres -d barberos_restore_test -c "\\dt"
```

## Logs

Arquivo de log do cron:

```bash
/var/backups/barbermain/postgres/logs/postgres-backup.log
```

O script nao imprime senha do banco nem credenciais em texto puro.

## Pontos de atencao

- o restore exige `--force` de proposito, para evitar execucao destrutiva acidental
- o cron precisa rodar no host Linux com acesso ao `docker`
- se o nome do task/container mudar no EasyPanel, a descoberta automatica deve continuar funcionando; use `POSTGRES_BACKUP_CONTAINER` apenas se quiser fixar um hint mais estavel
- antes de um restore no banco principal, interromper acessos concorrentes se quiser o procedimento mais seguro possivel
