-- =====================================================
-- ECOS - Migração 003 (OPCIONAL): datas com fuso horário
--
-- Problema: telemetria.data_coleta é TIMESTAMPTZ, mas colaborador.data_cadastro, baseline.data_calculo,
-- anomalia.data_deteccao, alerta.data_criacao e alerta.data_resolucao são TIMESTAMP (sem fuso).
-- A API compara os dois tipos e agrupa por dia/hora: o resultado muda conforme o fuso do servidor
-- PostgreSQL (um servidor em UTC "vira o dia" às 21h no Brasil) e o JSON sai sem indicação de fuso.
--
-- ANTES DE APLICAR:
--   1. Avise quem cuida de ai/. O psycopg (versão 3, usado em ai/) passa a devolver datetime COM fuso nessas colunas;
--      o motor atual (ai/anomaly_detector.py) já foi testado com esta migração e continua funcionando.
--   2. Faça backup:  pg_dump -U postgres ecos_db > backup_ecos.sql
--   3. Confira o fuso em que os valores antigos foram gravados. Aqui assumimos America/Sao_Paulo;
--      se o seu PostgreSQL rodava em UTC, troque o nome do fuso nas linhas abaixo.
--
-- Como aplicar:
--   psql -U postgres -d ecos_db -f database/migracoes/003_datas_fuso.sql
--
-- Depois, defina ECOS_DB_TIMEZONE=America/Sao_Paulo no api/.env para os "dias" dos gráficos
-- fecharem à meia-noite de Brasília, e atualize o database/schema.sql trocando TIMESTAMP por TIMESTAMPTZ.
-- =====================================================

BEGIN;

ALTER TABLE colaborador
    ALTER COLUMN data_cadastro TYPE TIMESTAMPTZ
    USING data_cadastro AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE baseline
    ALTER COLUMN data_calculo TYPE TIMESTAMPTZ
    USING data_calculo AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE anomalia
    ALTER COLUMN data_deteccao TYPE TIMESTAMPTZ
    USING data_deteccao AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE alerta
    ALTER COLUMN data_criacao TYPE TIMESTAMPTZ
    USING data_criacao AT TIME ZONE 'America/Sao_Paulo';

ALTER TABLE alerta
    ALTER COLUMN data_resolucao TYPE TIMESTAMPTZ
    USING data_resolucao AT TIME ZONE 'America/Sao_Paulo';

COMMIT;
