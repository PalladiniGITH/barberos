# BarberEX Security Baseline

## Principios

- Nunca confiar no frontend.
- Toda acao sensivel precisa validar sessao, role, tenant e ownership no backend.
- Multi-tenant sempre usa `barbershopId` resolvido no servidor.
- Toda entrada mutavel deve passar por validacao server-side.
- Uploads e webhooks sao tratados como superficies hostis por padrao.
- Logs devem ser uteis sem expor secrets, tokens, telefones completos ou payloads desnecessarios.
- Segurança precisa ser verificavel: teste, build e CI.

## Checklist para novas features

- A feature roda sem depender de permissao enviada pelo client?
- Existe validacao server-side para todos os campos mutaveis?
- O tenant vem da sessao/tenant resolvido no backend?
- IDs recebidos foram conferidos contra o `barbershopId` da sessao?
- Roles foram validadas no backend?
- O retorno evita expor detalhes internos, stack ou secrets?
- Existe ao menos um teste cobrindo isolamento, RBAC ou input invalido?

## Checklist para Server Actions

- Usar `requireAuthenticatedUser()` ou helper equivalente.
- Validar `role` com `requireRole()` ou assert especifico.
- Garantir `barbershopId` com `requireBarbershopContext()`.
- Validar payload com `zod` ou equivalente.
- Conferir ownership dos recursos antes de criar/editar/remover.
- Revalidar apenas as superficies necessarias.
- Em caso de erro, retornar mensagem segura para UI e log sanitizado no servidor.

## Checklist para API Routes

- Exigir auth quando a rota e mutavel ou sensivel.
- Validar metodo e payload.
- Nunca confiar em IDs, telefones, slugs ou `barbershopId` vindos do client.
- Conferir tenant e ownership antes de persistir dados.
- Responder com codigos sem vazar diagnosticos internos.
- Usar `safeLog()` para logs estruturados.

## Checklist Multi-tenant

- `barbershopId` sempre vem da sessao ou da resolucao do tenant.
- Recursos relacionados precisam pertencer ao mesmo tenant.
- Nunca usar `barbershopId` do frontend como fonte de verdade.
- Testar cenarios cruzados Linha Nobre/Konoha.

## Checklist para upload de arquivos

- Exigir auth e role valida.
- Validar tenant do recurso alvo.
- Aceitar apenas MIME types permitidos.
- Validar assinatura binaria quando possivel.
- Limitar tamanho.
- Nao usar filename original.
- Nao aceitar SVG nesta fase.
- Gravar fora do app em volume persistente.
- Servir arquivos com `nosniff` e caminho seguro.

## Checklist para webhooks

- Validar secret.
- Validar `instanceName`.
- Resolver tenant no backend.
- Bloquear mismatch entre instancia e tenant.
- Ignorar eventos nao usados com `200/204` quando apropriado.
- Dedupe basico para evitar replay acidental.
- Nao logar payload bruto sem sanitizacao.

## Checklist para logs

- Mascarar secrets, tokens, chaves, cookies e autorizacoes.
- Mascarar telefones e emails quando nao forem necessarios completos.
- Resumir mensagens de cliente, prompts e payloads longos.
- Evitar stack trace completo em logs comuns.
- Priorizar ids, tenant, status e erro categorizado.

## Checklist para IA / OpenAI

- O contexto enviado para IA deve ficar restrito ao tenant atual.
- A IA nunca substitui validacao server-side para acao destrutiva.
- Nao expor prompts internos, secrets ou payloads sensiveis.
- Custos e uso devem ser logados sem vazar conteudo desnecessario.
- Prompt injection deve ser tratada como entrada nao confiavel.

## Checklist para deploy / env

- `NEXTAUTH_SECRET` obrigatorio em producao.
- `EVOLUTION_WEBHOOK_SECRET` obrigatorio em producao.
- `UPLOAD_LOCAL_DIR` precisa apontar para volume persistente.
- Secrets nunca usam prefixo `NEXT_PUBLIC_`.
- `.env` real nao entra em git.

## Como rodar scans de seguranca

- `npm run security:test`
- `npm run security:audit`
- `npm run test:whatsapp`
- `npm run build`

## Como tratar vulnerabilidades

- `high` e `critical`: corrigir antes de merge/deploy.
- `moderate`: revisar impacto, abrir issue e acompanhar.
- Nunca rodar `npm audit fix` automatico sem revisar diff e impacto.

## Criterios de bloqueio de build

- Testes de seguranca falhando.
- Build falhando.
- Suite critica de WhatsApp falhando.
- `npm audit --audit-level=high` falhando no workflow de seguranca.

## O que nunca fazer

- Criar `/login`.
- Confiar em role, tenant ou ownership vindos do frontend.
- Salvar binario no banco.
- Logar secrets, tokens ou prompts sensiveis completos.
- Liberar upload publico com escrita direta.
- Aceitar arquivo perigoso so pela extensao.
