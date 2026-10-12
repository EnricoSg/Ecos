-- =====================================================
-- MIGRAÇÃO 001 - Controle de processamento da IA
--
-- Marca cada telemetria com o momento em que o motor de IA a analisou.
-- NULL = ainda não processada. Uma marca por linha (em vez de guardar só o
-- "último id processado") evita perder registros quando lotes da API são
-- gravados fora da ordem dos ids.
--
-- Pode ser executada mais de uma vez sem erro.
-- Uso: psql -U postgres -d ecos_db -f database/migracoes/001_telemetria_analisada_em.sql
-- =====================================================

ALTER TABLE telemetria
    ADD COLUMN IF NOT EXISTS analisada_em TIMESTAMPTZ;

-- Índice parcial: só contém as linhas pendentes, então continua pequeno
-- mesmo com milhões de telemetrias já analisadas.
CREATE INDEX IF NOT EXISTS idx_telemetria_pendente
    ON telemetria (colaborador_id, data_coleta)
    WHERE analisada_em IS NULL;
