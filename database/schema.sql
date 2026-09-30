-- =====================================================
-- ECOS - Estrutura do Banco de Dados
-- PostgreSQL
-- =====================================================

SET search_path TO public;


-- =====================================================
-- COLABORADOR
-- Representa um colaborador de forma anonimizada.
-- Nenhum dado pessoal ou conteúdo digitado é armazenado.
-- =====================================================

CREATE TABLE colaborador (
    id SERIAL PRIMARY KEY,
    codigo_anonimo VARCHAR(64) NOT NULL UNIQUE,
    setor VARCHAR(100),
    data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ativo BOOLEAN DEFAULT TRUE
);


-- =====================================================
-- TELEMETRIA
-- Armazena métricas comportamentais coletadas pelo
-- sistema, sem registrar o conteúdo digitado.
--
-- dwell_time  = tempo que uma tecla permanece pressionada
-- flight_time = intervalo entre eventos de digitação
-- mouse_speed = velocidade do movimento do cursor
-- =====================================================

CREATE TABLE telemetria (
    id SERIAL PRIMARY KEY,

    colaborador_id INTEGER NOT NULL,

    dwell_time INTEGER NOT NULL,
    flight_time INTEGER NOT NULL,
    mouse_speed INTEGER NOT NULL,

    data_coleta TIMESTAMPTZ NOT NULL,

    CONSTRAINT chk_telemetria_valores_positivos
        CHECK (
            dwell_time >= 0
            AND flight_time >= 0
            AND mouse_speed >= 0
        ),

    CONSTRAINT fk_telemetria_colaborador
        FOREIGN KEY (colaborador_id)
        REFERENCES colaborador(id)
);


-- =====================================================
-- BASELINE
-- Representa o padrão comportamental de referência
-- calculado para cada colaborador.
-- =====================================================

CREATE TABLE baseline (
    id SERIAL PRIMARY KEY,

    colaborador_id INTEGER NOT NULL,

    media_dwell_time NUMERIC(10,2),
    media_flight_time NUMERIC(10,2),
    media_mouse_speed NUMERIC(10,2),

    data_calculo TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_baseline_colaborador
        FOREIGN KEY (colaborador_id)
        REFERENCES colaborador(id)
);


-- =====================================================
-- ANOMALIA
-- Registra desvios encontrados ao comparar uma
-- telemetria com o baseline do colaborador.
-- =====================================================

CREATE TABLE anomalia (
    id SERIAL PRIMARY KEY,

    colaborador_id INTEGER NOT NULL,
    telemetria_id INTEGER NOT NULL,
    baseline_id INTEGER NOT NULL,

    nivel VARCHAR(20) NOT NULL,
    pontuacao_desvio NUMERIC(10,2),

    data_deteccao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_anomalia_nivel
        CHECK (
            nivel IN ('BAIXO', 'MEDIO', 'ALTO')
        ),

    CONSTRAINT fk_anomalia_colaborador
        FOREIGN KEY (colaborador_id)
        REFERENCES colaborador(id),

    CONSTRAINT fk_anomalia_telemetria
        FOREIGN KEY (telemetria_id)
        REFERENCES telemetria(id),

    CONSTRAINT fk_anomalia_baseline
        FOREIGN KEY (baseline_id)
        REFERENCES baseline(id)
);


-- =====================================================
-- ALERTA
-- Registra alertas gerados a partir de anomalias
-- identificadas pelo sistema.
-- =====================================================

CREATE TABLE alerta (
    id SERIAL PRIMARY KEY,

    anomalia_id INTEGER NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    mensagem VARCHAR(255),

    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_resolucao TIMESTAMP,

    CONSTRAINT chk_alerta_status
        CHECK (
            status IN ('PENDENTE', 'RESOLVIDO')
        ),

    CONSTRAINT fk_alerta_anomalia
        FOREIGN KEY (anomalia_id)
        REFERENCES anomalia(id)
);


-- =====================================================
-- ÍNDICES
-- Melhoram consultas frequentes do sistema.
-- =====================================================

CREATE INDEX idx_telemetria_colaborador_data
    ON telemetria (colaborador_id, data_coleta);

CREATE INDEX idx_anomalia_colaborador_data
    ON anomalia (colaborador_id, data_deteccao);

CREATE INDEX idx_alerta_status
    ON alerta (status);