# Auth Strategy

## Context

O sistema utiliza autenticação baseada em sessão (NextAuth).

Durante evolução do projeto, a rota `/login` deixou de existir.

---

## Rule

- NÃO existe página `/login` no sistema
- Qualquer redirect para `/login` é considerado bug

---

## Fluxo oficial

### Usuário não autenticado

→ Deve ser redirecionado para `/`

---

### Usuário autenticado

→ Pode acessar rotas protegidas como `/dashboard`

---

## Middleware

Middleware deve:

- validar sessão
- redirecionar corretamente
- nunca apontar para rotas inexistentes

---

## Impact

- Evita erro 404 em produção
- Mantém consistência do fluxo de autenticação
- Reduz bugs em rollback/deploy

---

## Anti-patterns (PROIBIDO)

- redirect para `/login`
- uso de `callbackUrl` apontando para `/login`
- criação de página `/login` sem decisão arquitetural

---

## Notes

Se for necessário mudar o fluxo de autenticação:

- atualizar este documento
- validar impacto em todas as rotas protegidas