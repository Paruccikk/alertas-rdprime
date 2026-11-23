# Day Alertas

Sistema independente para importar, organizar, segmentar e gerenciar listas de contatos e campanhas de WhatsApp e e-mail.

> **Estado inicial:** estrutura de desenvolvimento. Nenhum disparo real é executado nesta versão.

## Stack
- Node.js 20+ / Express
- PostgreSQL
- Painel administrativo estático na primeira etapa
- Armazenamento privado e persistente de arquivos

## Começar
1. Copie `.env.example` para `.env` e configure os valores.
2. Execute `npm install`.
3. Crie um banco PostgreSQL dedicado e aplique `database/schema.sql`.
4. Execute `npm run dev`.
5. Acesse `http://localhost:3000`.

## Segurança e privacidade
- Nunca versione `.env`, planilhas reais, exports ou credenciais.
- Importar um telefone/e-mail não equivale a consentimento.
- Registrar origem, finalidade, canal e evidência do opt-in.
- Descadastro e lista global de supressão devem prevalecer sobre qualquer lista.
- WhatsApp somente via API oficial da Meta ou provedor autorizado.
- Campanhas exigirão aprovação e validação de consentimento no momento do envio.

Veja [Plano](docs/PLANO.md) e [Privacidade](docs/PRIVACIDADE-E-COMPLIANCE.md).
