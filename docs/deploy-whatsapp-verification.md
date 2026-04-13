# Verificacao antes do deploy

## Comandos locais

Antes de subir qualquer mudanca no agente de WhatsApp, rode:

```bash
npm run verify
```

Esse comando executa:

```bash
npm run test:whatsapp
npm run build
```

## Como isso protege producao

- Se qualquer teste critico do WhatsApp falhar, o processo falha antes do build final.
- Se o build do Next.js falhar, o deploy tambem nao segue.
- Isso protege cenarios como:
  - promocao imediata de contexto
  - correcao de `nextAction` pelo backend
  - timezone correto no salvamento do agendamento
  - reset de contexto sujo

## GitHub + EasyPanel

Recomendacao:

1. GitHub Actions roda `npm run verify` em push e pull request.
2. EasyPanel usa `npm run verify` como comando de build/predeploy.
3. O app so deve ser publicado a partir da branch protegida que passou no workflow.

## Configuracao sugerida no EasyPanel

- Install command: `npm ci`
- Build command: `npm run verify`
- Start command: `npm start`

Se algum teste do agente quebrar, o EasyPanel interrompe o deploy automaticamente.
