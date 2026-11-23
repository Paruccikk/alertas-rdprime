# Day Alertas

Plataforma independente para cadastro de usuários aprovados pela administração, organização de listas e importação de contatos.

## Stack
- Node.js 20+ / Express
- Firebase Authentication (email e senha)
- Firebase Realtime Database
- Firebase Admin SDK no backend

## Fluxo de contas
1. O visitante cria uma conta com nome, e-mail, senha e WhatsApp.
2. Firebase Authentication cria a identidade e o UID.
3. O backend grava o perfil em `users/{uid}` com status `pending`.
4. O administrador definido em `ADMIN_EMAIL` entra e aprova ou recusa o cadastro.
5. Somente contas aprovadas podem entrar.
6. Os dados de cada conta ficam isolados em `accounts/{uid}/` (listas, contatos e importações).

A senha fica exclusivamente no Firebase Authentication. Nunca grave senhas no Realtime Database.

## Configuração local
1. Copie `.env.example` para `.env`.
2. Configure `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT`, `ADMIN_EMAIL` e `SESSION_SECRET`.
3. Instale dependências com `npm install`.
4. Execute `npm start`.
5. Acesse `http://localhost:3000`.

## Render
Configure as mesmas variáveis no serviço Web `day-alertas`. Não coloque a service account, session secret ou segredos de integração no GitHub. O endpoint `/api/public-config` entrega somente a configuração pública do Firebase Web SDK.

## Regras do Realtime Database
Para este desenho, o navegador não acessa o banco diretamente. Mantenha as regras do RTDB negando leitura e gravação públicas; o backend usa Firebase Admin SDK, que opera com privilégios administrativos. Todas as rotas privadas exigem sessão validada pelo backend.

## Segurança e privacidade
- Nunca versione `.env`, service accounts, tokens ou segredos.
- O administrador é definido por `ADMIN_EMAIL`; somente ele pode aprovar contas.
- Cada usuário aprovado acessa apenas seu próprio nó `accounts/{uid}`.
- A senha é gerenciada exclusivamente pelo Firebase Authentication.
- Importar um telefone/e-mail não equivale a consentimento.
- Registrar origem, finalidade, canal e evidência do opt-in.
- Descadastro e lista de supressão devem prevalecer antes de qualquer envio.
- WhatsApp somente via API oficial da Meta ou provedor autorizado.
- Nenhum envio sem consentimento válido e aprovação explícita.

Veja [Privacidade e compliance](docs/PRIVACIDADE-E-COMPLIANCE.md).
