-- =====================================================
-- ECOS - Dados iniciais para testes
-- =====================================================

SET search_path TO public;

-- -----------------------------------------------------
-- COLABORADORES
-- -----------------------------------------------------

INSERT INTO colaborador (codigo_anonimo, setor)
VALUES
    ('USR-A7F92C', 'Tecnologia da Informação'),
    ('USR-B4K81M', 'Financeiro'),
    ('USR-C9P23X', 'Recursos Humanos');


-- -----------------------------------------------------
-- TELEMETRIAS
-- Dados comportamentais utilizados para testes
-- -----------------------------------------------------

-- Colaborador 1 - Tecnologia da Informação

INSERT INTO telemetria
    (colaborador_id, velocidade_digitacao, tempo_medio_pausa, velocidade_mouse)
VALUES
    (1, 62.50, 1.20, 450.30),
    (1, 60.80, 1.35, 440.10),
    (1, 61.90, 1.25, 455.70);


-- Colaborador 2 - Financeiro

INSERT INTO telemetria
    (colaborador_id, velocidade_digitacao, tempo_medio_pausa, velocidade_mouse)
VALUES
    (2, 55.20, 1.50, 390.40),
    (2, 56.10, 1.45, 395.20),
    (2, 54.80, 1.55, 388.70);


-- Colaborador 3 - Recursos Humanos

INSERT INTO telemetria
    (colaborador_id, velocidade_digitacao, tempo_medio_pausa, velocidade_mouse)
VALUES
    (3, 68.30, 1.05, 480.20),
    (3, 67.80, 1.10, 475.60),
    (3, 69.10, 1.00, 485.30);
    -- -----------------------------------------------------
-- BASELINES
-- Padrão comportamental inicial de cada colaborador
-- calculado a partir das telemetrias normais
-- -----------------------------------------------------

INSERT INTO baseline
    (colaborador_id, media_velocidade_digitacao, media_tempo_pausa, media_velocidade_mouse)
VALUES
    (1, 61.73, 1.27, 448.70),
    (2, 55.37, 1.50, 391.43),
    (3, 68.40, 1.05, 480.37);
    -- -----------------------------------------------------
-- TELEMETRIAS ANÔMALAS
-- Dados simulados com alteração significativa em
-- relação ao padrão comportamental do colaborador
-- -----------------------------------------------------

-- Colaborador 1 - Tecnologia da Informação

INSERT INTO telemetria
    (colaborador_id, velocidade_digitacao, tempo_medio_pausa, velocidade_mouse)
VALUES
    (1, 35.00, 4.80, 250.00);


-- Colaborador 3 - Recursos Humanos

INSERT INTO telemetria
    (colaborador_id, velocidade_digitacao, tempo_medio_pausa, velocidade_mouse)
VALUES
    (3, 39.50, 4.20, 270.00);

    -- -----------------------------------------------------
-- ANOMALIAS
-- Registros associados às telemetrias que apresentaram
-- desvio significativo em relação ao baseline
-- -----------------------------------------------------

-- Anomalia do Colaborador 1
INSERT INTO anomalia
    (colaborador_id, telemetria_id, baseline_id, nivel)
VALUES
    (1, 10, 1, 'ALTO');


-- Anomalia do Colaborador 3
INSERT INTO anomalia
    (colaborador_id, telemetria_id, baseline_id, nivel)
VALUES
    (3, 11, 3, 'ALTO');
-- -----------------------------------------------------
-- ALERTAS
-- Alertas gerados a partir das anomalias detectadas
-- -----------------------------------------------------

INSERT INTO alerta
    (anomalia_id, status, mensagem)
VALUES
    (1, 'PENDENTE',
     'Desvio significativo detectado no padrão comportamental do colaborador.'),
    (2, 'PENDENTE',
     'Desvio significativo detectado no padrão comportamental do colaborador.');
    
    -- -----------------------------------------------------