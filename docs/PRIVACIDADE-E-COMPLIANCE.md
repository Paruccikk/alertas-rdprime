# Privacidade, LGPD e regras dos canais

Documento de controles técnicos; não substitui avaliação jurídica.

## Regras do produto
1. Registrar origem, finalidade, canal, data e evidência do consentimento.
2. Não presumir opt-in pela presença do telefone/e-mail em planilha.
3. Permitir revogação e descadastro por canal.
4. Consultar a lista de supressão antes de qualquer envio.
5. Auditar importações, alterações, aprovações e envios.
6. Restringir acesso administrativo e proteger credenciais.
7. Definir retenção e descarte seguro dos arquivos.
8. Nunca expor arquivos originais por URL pública.

## WhatsApp
- API oficial da Meta ou provedor autorizado.
- Respeitar opt-in e políticas vigentes do WhatsApp Business.
- Usar modelos aprovados quando exigidos e oferecer forma clara de parar mensagens.

## E-mail
- Identificar o remetente.
- Incluir descadastro funcional.
- Processar bounces e reclamações e suprimir novos envios aos destinos correspondentes.

## Segurança
- TLS em produção e segredos somente em variáveis de ambiente/secret manager.
- Criptografia de dados pessoais em repouso e em trânsito.
- Backups protegidos, menor privilégio e auditoria.
- Nunca registrar tokens ou listas completas nos logs.

Validar base legal, finalidade e requisitos aplicáveis à operação concreta com assessoria responsável.
