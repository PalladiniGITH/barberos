# BarberEX Threat Model

## Ameacas principais

### Acesso cruzado entre tenants

- Risco: usuario da Linha Nobre ler ou alterar dados da Konoha.
- Mitigacao: tenant resolvido no servidor, ownership por `barbershopId`, testes de isolamento.

### Escalada de privilegio por role

- Risco: `BARBER` acessar gestao financeira/equipe; `ADMIN` comum acessar `/internal`.
- Mitigacao: guardas server-side de role e platform role, testes RBAC.

### Spoof ou replay de webhook Evolution

- Risco: payload falso ou reprocessamento indevido.
- Mitigacao: secret obrigatorio, resolucao de `instanceName`, dedupe, ignorar eventos nao usados com resposta segura.

### Upload malicioso

- Risco: SVG/script, executavel disfarcado, path traversal, overwrite.
- Mitigacao: MIME whitelist, assinatura binaria, nome aleatorio, raiz fixa, `nosniff`, volume persistente fora do app.

### Vazamento de secrets em logs

- Risco: chave da Evolution, OpenAI, NextAuth ou webhook parar em console/observabilidade.
- Mitigacao: `safeLog()`, mascaramento por chave, truncamento de payloads, evitar stack completo por padrao.

### Manipulacao de IDs no frontend

- Risco: editar profissional/agendamento/financeiro de outro tenant alterando ID.
- Mitigacao: ownership no backend, nunca confiar em `barbershopId` vindo do client.

### Alteracao indevida de status operacionais/financeiros

- Risco: mudar `status`, receita, despesa ou appointment sem permissao.
- Mitigacao: helpers de role + ownership + validacao de schema.

### Prompt injection e abuso de IA

- Risco: usuario pedir ignorar regras, extrair dados internos ou aumentar custo.
- Mitigacao: escopo por tenant/role, bloqueio de pedidos sensiveis, logs sanitizados, acoes destrutivas sempre no backend.

### CSRF / abuso de rotas mutaveis

- Risco: chamada autenticada indevida em rotas de mutacao.
- Mitigacao: auth server-side, validacao de sessao e contexto, rotas mutaveis sem confiar no client.

### Dados sensiveis no client bundle

- Risco: secrets em `NEXT_PUBLIC_*` ou payload sensivel serializado.
- Mitigacao: documentacao de env, revisao de variaveis publicas, fetch server-side para dados sensiveis.
