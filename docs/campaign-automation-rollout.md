# Rollout seguro da automacao diaria de campanhas

## Estado inicial recomendado

Subir em producao com a automacao desligada:

```env
CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED=false
```

Se `AUTOMATION_RUNNER_SECRET` nao for definido, o scheduler interno usa `NEXTAUTH_SECRET`.

## Mudancas de schema que precisam existir no banco

Campos novos em `customers`:

- `birthDate`
- `marketingOptOutAt`

Tabelas novas:

- `campaign_automation_configs`
- `campaign_automation_runs`
- `campaign_automation_deliveries`

Enums novos:

- `CampaignAutomationType`
- `CampaignAutomationBenefitType`
- `CampaignAutomationTrigger`
- `CampaignAutomationRunStatus`
- `CampaignAutomationChannel`
- `CampaignAutomationDeliveryStatus`

## Comando recomendado para aplicar o schema no banco atual

Como o projeto hoje trabalha sem pasta de migrations versionadas para esse fluxo, o caminho mais seguro para o banco atual e:

```bash
npm run db:push
```

Recomendacao operacional:

1. garantir backup/snapshot do banco antes
2. manter `CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED=false`
3. rodar `npm run db:push`
4. rodar `npm run build`
5. subir a aplicacao e validar sem disparo real

## Validacao antes de ativar a automacao

Com a automacao desligada, validar:

1. o sistema sobe normalmente
2. `npm run build` continua passando
3. dashboard, agenda, clientes, equipe e inteligencia continuam funcionando
4. a rota interna existe no build: `/api/internal/campaign-automation/run`
5. nenhuma mensagem e enviada enquanto `CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED=false`

## Checklist curto de ativacao segura

1. aplicar schema com `npm run db:push`
2. manter automacao desligada no primeiro deploy
3. validar build e navegacao principal
4. confirmar que Evolution/WhatsApp esta apontando para a instancia correta
5. revisar `AUTOMATION_RUNNER_SECRET` ou confirmar uso consciente de `NEXTAUTH_SECRET`
6. revisar beneficios padrao em `campaign_automation_configs`
7. habilitar a automacao apenas depois da validacao

## Como ativar depois da validacao

Trocar no ambiente:

```env
CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED=true
```

Opcionalmente definir um segredo proprio:

```env
AUTOMATION_RUNNER_SECRET="um-segredo-interno-exclusivo-para-o-scheduler"
```

Depois:

1. reiniciar a aplicacao
2. verificar logs de boot para confirmar o heartbeat do scheduler
3. acompanhar os logs de `[campaign-automation]` e `[boot] campaign_automation_*`
