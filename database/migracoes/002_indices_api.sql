-- =====================================================
-- ECOS - Migração 002: índices para as consultas da API
-- Segura de rodar a qualquer momento (IF NOT EXISTS) e não altera dados.
--
-- Como aplicar:
--   psql -U postgres -d ecos_db -f database/migracoes/002_indices_api.sql
--
-- Os mesmos índices já estão no database/schema.sql,
-- então bancos novos já nascem com eles. Requer a migração 001 (coluna analisada_em, citada na retenção).
-- =====================================================

-- GET /api/alertas: o JOIN alerta -> anomalia não tinha índice na chave estrangeira
CREATE INDEX IF NOT EXISTS idx_alerta_anomalia
    ON alerta (anomalia_id);

-- GET /api/alertas: ORDER BY data_criacao DESC, id DESC com paginação
CREATE INDEX IF NOT EXISTS idx_alerta_criacao
    ON alerta (data_criacao DESC, id DESC);

-- GET /api/anomalias: filtra só por período; o índice existente começa por colaborador_id e não ajuda
CREATE INDEX IF NOT EXISTS idx_anomalia_deteccao
    ON anomalia (data_deteccao);

-- JOIN de detalhe do alerta (anomalia -> telemetria) e proteção da FK
CREATE INDEX IF NOT EXISTS idx_anomalia_telemetria
    ON anomalia (telemetria_id);

-- Baseline mais recente de cada colaborador (DISTINCT ON ... ORDER BY data_calculo DESC)
CREATE INDEX IF NOT EXISTS idx_baseline_colaborador_data
    ON baseline (colaborador_id, data_calculo DESC, id DESC);

-- Filtros por setor entre colaboradores ativos
CREATE INDEX IF NOT EXISTS idx_colaborador_setor_ativo
    ON colaborador (setor)
    WHERE ativo;

-- =====================================================
-- RETENÇÃO (opcional, decisão de política: alinhar com a auditoria LGPD da equipe)
-- Telemetria é dado de saúde ocupacional e não deve ser guardada para sempre.
-- Exemplo que apaga telemetria já analisada e com mais de 90 dias, preservando
-- as linhas que uma anomalia ainda referencia (a FK impediria apagá-las):
--
-- DELETE FROM telemetria t
-- WHERE t.data_coleta < now() - interval '90 days'
--   AND t.analisada_em IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM anomalia a WHERE a.telemetria_id = t.id);
-- =====================================================
