# Migration Playbook

## Objetivo

Guiar a implantacao de novos tenants no BarberEX sem depender de acesso direto ao banco.

## 1. Barbearia sem sistema anterior

1. Criar ou revisar a barbearia no `/internal`.
2. Validar nome, slug, timezone e status operacional.
3. Cadastrar profissionais.
4. Revisar servicos, preco e duracao.
5. Configurar bloqueios operacionais e janela inicial da agenda.
6. Cadastrar clientes principais.
7. Configurar WhatsApp / Evolution.
8. Rodar piloto com agenda futura minima e checklist completo.

## 2. Barbearia vinda do Cash Barber

1. Levantar equipe atual, servicos, precos e duracoes.
2. Identificar clientes principais, assinantes e agenda futura.
3. Alimentar manualmente profissionais, servicos e clientes pelo `/internal`.
4. Revisar disponibilidade operacional e bloqueios manuais para treinamento ou pausa.
5. Configurar WhatsApp / Evolution antes do piloto.
6. Validar agenda futura e comunicacoes criticas.
7. Liberar piloto com acompanhamento proximo nos primeiros dias.

## 3. Dados a coletar antes da migracao

- Profissionais: nome, telefone, email, avatar, comissao, escopo de atendimento
- Servicos: nome, preco, duracao, descricao, categoria
- Clientes: nome, telefone, email, observacoes, tipo, assinatura, preferencia de profissional
- Agenda futura: cliente, profissional, servico, data e horario
- Financeiro basico: categorias essenciais e precificacao minima
- WhatsApp: instance, status esperado, janela de entrada no piloto

## 4. Checklist antes do piloto

- Nome, slug e timezone validados
- Profissionais ativos cadastrados
- Servicos ativos com preco e duracao revisados
- Bloqueios operacionais e agenda minima preparados
- Clientes principais cadastrados
- WhatsApp habilitado e instance configurada
- Checklist de implantacao sem pendencias criticas

## 5. Checklist depois do piloto

- Confirmar uso real da agenda
- Revisar erros recentes de IA, WhatsApp e automacoes
- Ajustar servicos, bloqueios ou equipe conforme operacao
- Validar clientes e agenda futura importados manualmente
- Formalizar passagem de "Em piloto" para "Ativo"

## 6. Futuro importador CSV

Campos-base sugeridos:

- Profissionais: `name`, `email`, `phone`, `attendanceScope`, `commissionRate`
- Servicos: `name`, `price`, `duration`, `description`, `category`
- Clientes: `name`, `phone`, `email`, `type`, `subscriptionStatus`
- Agenda futura: `customerName`, `professionalName`, `serviceName`, `date`, `time`

## 7. Futuro conector Cash Barber / API

Quando houver formato confiavel:

1. Mapear entidades de origem para models do BarberEX.
2. Validar tenant alvo no backend antes de importar.
3. Rodar importacao em etapa de preview.
4. Salvar auditoria da migracao por tenant.
5. Confirmar agenda futura e clientes principais antes do go-live.

## 8. Regras de seguranca

- Nunca confiar no frontend para definir tenant alvo.
- Toda mutacao interna deve passar por `requirePlatformAdmin()`.
- IDs de profissional, servico, cliente e bloqueio precisam ser buscados no backend.
- Nao fazer importacao automatica sem validacao server-side e trilha de auditoria.
