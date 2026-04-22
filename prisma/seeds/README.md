# Linha Nobre Seed

Seed oficial do MVP da barbearia Linha Nobre para demo e staging.

## Modos de seguranca

### `SEED_DRY_RUN=true`
Nao executa writes.
Mostra:
- alvo do banco
- tenant afetado
- o que sera reconciliado
- o que sera limpo e recriado
- outras barbearias encontradas e que ficarao intactas

Uso:

```bash
SEED_DRY_RUN=true prisma db seed
```

### `SEED_ONLY_LINHA_NOBRE=true`
Habilita execucao real da seed oficial.
Sem esse flag, a seed bloqueia qualquer escrita.

Uso:

```bash
SEED_ONLY_LINHA_NOBRE=true prisma db seed
```

## Fluxo recomendado

1. Rodar primeiro em preview:

```bash
SEED_DRY_RUN=true prisma db seed
```

2. Conferir no log:
- host e database alvo
- se o slug afetado e `linha-nobre`
- se as outras barbearias listadas ficarao untouched

3. Executar a seed real somente no banco demo/staging:

```bash
SEED_ONLY_LINHA_NOBRE=true prisma db seed
```

## Comportamento

- Entidades canonicas sao reconciliadas: tenant, usuarios, profissionais, categorias, insumos, servicos e clientes.
- Modulos operacionais da Linha Nobre sao limpos e recriados: agenda, receitas, despesas, metas, desafios, comissoes e campanhas.
- Outras barbearias do banco nao sao alteradas.
