# AGENTS.md

## Objective

Garantir que qualquer alteração no projeto seja feita de forma segura, consistente e sem regressões.

---

## Core Rules

- Nunca quebrar rotas existentes sem validar impacto
- Nunca alterar fluxo de autenticação sem entender middleware + NextAuth
- Nunca criar rotas novas sem necessidade explícita
- Nunca assumir comportamento — sempre verificar código existente

---

## Auth & Routing (CRÍTICO)

- NÃO utilizar `/login` como rota padrão
- O sistema atual NÃO possui página `/login`
- Qualquer redirect para `/login` deve ser considerado bug

### Fluxo correto:

- Usuário NÃO autenticado → redirecionar para `/`
- Usuário autenticado → acessar `/dashboard`

---

## Before Changing Code

Sempre:

1. Identificar arquivos impactados
2. Verificar:
   - middleware.ts
   - config do NextAuth
   - redirects
   - uso de `callbackUrl`
3. Entender fluxo atual antes de alterar

---

## Validation Rules

Antes de concluir qualquer tarefa:

- Rodar build
- Garantir que não existem rotas inválidas
- Garantir que não existem redirects quebrados
- Garantir que auth continua funcionando

---

## Do NOT

- Não criar `/login`
- Não alterar UI sem necessidade
- Não refatorar código fora do escopo
- Não remover segurança de rotas protegidas

---

## Done Criteria

Uma task só está concluída se:

- Não existem erros 404 inesperados
- Rotas principais funcionam:
  - `/`
  - `/dashboard`
- Auth funciona corretamente
- Nenhum redirect inválido existe