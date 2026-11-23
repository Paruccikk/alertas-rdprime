# Plano de implementação

## Etapa 1 — Fundação
- [x] Repositório privado separado
- [x] API Node/Express e health check
- [x] Esquema inicial PostgreSQL
- [ ] Configurar ambiente e validar conexão com banco
- [ ] Autenticação administrativa e perfis de acesso

## Etapa 2 — Importação
- Upload de CSV/XLSX com limite de tamanho e validação de tipo.
- Guardar o original em armazenamento privado persistente.
- Pré-visualizar antes de confirmar a importação.
- Mapear nome, e-mail, telefone, tags, origem e evidência de consentimento.
- Normalizar, deduplicar e gerar relatório de rejeições.

## Etapa 3 — Gestão de contatos
- Listas, tags, filtros e segmentos.
- Histórico de importações e alterações.
- Descadastro por canal e supressão global.
- Exportação controlada e auditada.

## Etapa 4 — Campanhas
- Editor de WhatsApp e e-mail.
- Aprovação explícita antes de agendar.
- Checagem de consentimento e supressão no momento do envio.
- Limites, lotes, idempotência, tentativas e auditoria.
- WhatsApp pela API oficial/solução autorizada.
- Tratamento de bounce, complaint e unsubscribe no e-mail.

## Etapa 5 — Operação
- Worker/fila assíncrona, métricas e alertas.
- Backups e restauração testada.
- Deploy isolado, domínio e TLS próprios.

**Regra:** nenhum envio sem consentimento válido para o canal, fora da supressão e sem aprovação. Importar uma planilha, por si só, não representa consentimento.
