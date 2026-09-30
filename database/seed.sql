-- =====================================================
-- ECOS - Dados iniciais para testes
-- =====================================================

SET search_path TO public;

-- -----------------------------------------------------
-- COLABORADORES
-- Identificadores anonimizados utilizados pelo sistema
-- -----------------------------------------------------

INSERT INTO colaborador (codigo_anonimo, setor)
VALUES
    ('a2a0159acf6ac55f05c0c4d4bdc54004', 'Tecnologia da Informação'),
    ('b4b1260bdf7bd66f16d1d5e5cef65115', 'Financeiro'),
    ('c5c2371cef8ce77f27e2e6f6dfa76226', 'Recursos Humanos');


-- -----------------------------------------------------
-- TELEMETRIAS
-- dwell_time e flight_time em milissegundos
-- mouse_speed representa a velocidade do cursor
-- Nenhum conteúdo digitado é armazenado
-- -----------------------------------------------------

-- Colaborador 1 - Tecnologia da Informação

INSERT INTO telemetria
    (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
VALUES
    (1, 103, 68, 476, '2026-09-30 08:00:00-03'),
    (1, 101, 145, 384, '2026-09-30 08:00:01-03'),
    (1, 65, 148, 694, '2026-09-30 08:00:02-03');


-- Colaborador 2 - Financeiro

INSERT INTO telemetria
    (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
VALUES
    (2, 92, 130, 410, '2026-09-30 08:05:00-03'),
    (2, 97, 125, 425, '2026-09-30 08:05:01-03'),
    (2, 95, 135, 400, '2026-09-30 08:05:02-03');


-- Colaborador 3 - Recursos Humanos

INSERT INTO telemetria
    (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
VALUES
    (3, 110, 100, 520, '2026-09-30 08:10:00-03'),
    (3, 105, 105, 510, '2026-09-30 08:10:01-03'),
    (3, 115, 95, 530, '2026-09-30 08:10:02-03');


-- -----------------------------------------------------
-- BASELINES
-- Padrão comportamental inicial de cada colaborador
-- calculado a partir das telemetrias normais
-- -----------------------------------------------------

INSERT INTO baseline
    (colaborador_id, media_dwell_time, media_flight_time, media_mouse_speed)
VALUES
    (1, 89.67, 120.33, 518.00),
    (2, 94.67, 130.00, 411.67),
    (3, 110.00, 100.00, 520.00);


-- -----------------------------------------------------
-- TELEMETRIAS ANÔMALAS
-- Dados simulados com alteração significativa em
-- relação ao padrão comportamental do colaborador
-- -----------------------------------------------------

-- Colaborador 1 - Tecnologia da Informação

INSERT INTO telemetria
    (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
VALUES
    (1, 280, 520, 180, '2026-09-30 09:00:00-03');


-- Colaborador 3 - Recursos Humanos

INSERT INTO telemetria
    (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
VALUES
    (3, 310, 490, 190, '2026-09-30 09:05:00-03');


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
    (
        1,
        'PENDENTE',
        'Desvio significativo detectado no padrão comportamental do colaborador.'
    ),
    (
        2,
        'PENDENTE',
        'Desvio significativo detectado no padrão comportamental do colaborador.'
    );