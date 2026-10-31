const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const {
    SQL_RESUMO_ALERTAS, SQL_DETALHE_ALERTA, PROPORCAO_CORTE, variacaoPercentual
} = require('../rotas/alertasDetalhe');
const { USER_ID, JWT_SECRET, configTeste, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

const TOKEN = jwt.sign({ papel: 'RH' }, JWT_SECRET, { subject: 'rh', expiresIn: '1h' });

function get(db, rota, config = configTeste()) {
    return request(createApp(db, config)).get(rota).set('Authorization', `Bearer ${TOKEN}`);
}

const LINHA_DETALHE = {
    id: 5,
    status: 'PENDENTE',
    mensagem: 'Desvio alto em 12/10 das 17:30 às 17:45: intervalo entre teclas +180%, tempo de pressão das teclas +35% em relação ao padrão do colaborador.',
    data_criacao: '2026-10-12T20:32:22.797Z',
    data_resolucao: null,
    anomalia_id: 3,
    nivel: 'ALTO',
    pontuacao_desvio: 3.220012,
    data_deteccao: '2026-10-12T20:32:22.797Z',
    codigo_anonimo: USER_ID,
    setor: 'TI',
    base_dwell_time: 93.87,
    base_flight_time: 92.96,
    base_mouse_speed: 480.39,
    data_calculo: '2026-10-12T20:31:32.108Z',
    janela_inicio: '2026-10-12T20:30:00.000Z',
    janela_fim: '2026-10-12T20:45:00.000Z',
    eventos: 43,
    obs_dwell_time: 126.6153,
    obs_flight_time: 260.0294,
    obs_mouse_speed: 319.6667
};

describe('GET /api/alertas/resumo', () => {
    test('200: contadores para os cards do Dashboard', async () => {
        const contadores = { pendentes: 5, resolvidos: 12, pendentes_alto: 2, pendentes_medio: 3, horas_medias_ate_resolver: 26.4 };
        const db = criarBancoFalso({ rows: [contadores] });

        const resposta = await get(db, '/api/alertas/resumo');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ setor: null, ...contadores });
        expect(db.query).toHaveBeenCalledWith(SQL_RESUMO_ALERTAS, [null]);
    });

    test('filtra por setor', async () => {
        const db = criarBancoFalso({ rows: [{ pendentes: 0 }] });

        const resposta = await get(db, '/api/alertas/resumo?setor=Financeiro');

        expect(resposta.body.setor).toBe('Financeiro');
        expect(db.query).toHaveBeenCalledWith(SQL_RESUMO_ALERTAS, ['Financeiro']);
    });

    test('"resumo" não é confundido com o id de um alerta', async () => {
        const db = criarBancoFalso({ rows: [{ pendentes: 0 }] });

        await get(db, '/api/alertas/resumo');

        expect(db.query).not.toHaveBeenCalledWith(SQL_DETALHE_ALERTA, expect.anything());
    });

    test('400: setor repetido', async () => {
        const db = criarBancoFalso();

        const resposta = await get(db, '/api/alertas/resumo?setor=TI&setor=RH');

        expect(resposta.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('401: exige token', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/alertas/resumo');

        expect(resposta.status).toBe(401);
    });
});

describe('GET /api/alertas/:id', () => {
    test('200: compara a janela avaliada pela IA com o baseline, com os percentuais da mensagem', async () => {
        const db = criarBancoFalso({ rows: [LINHA_DETALHE] });

        const resposta = await get(db, '/api/alertas/5');

        expect(resposta.status).toBe(200);
        expect(resposta.body.comparacao).toEqual({
            baseline: { dwell_time: 93.87, flight_time: 92.96, mouse_speed: 480.39, data_calculo: '2026-10-12T20:31:32.108Z' },
            observado: {
                dwell_time: 126.62,
                flight_time: 260.03,
                mouse_speed: 319.67,
                eventos: 43,
                janela_inicio: '2026-10-12T20:30:00.000Z',
                janela_fim: '2026-10-12T20:45:00.000Z'
            },
            variacao_percentual: { dwell_time: 34.9, flight_time: 179.7, mouse_speed: -33.5 }
        });
        // Arredondados para inteiro, são os +35% e +180% citados na mensagem
        expect(Math.round(resposta.body.comparacao.variacao_percentual.flight_time)).toBe(180);
        expect(Math.round(resposta.body.comparacao.variacao_percentual.dwell_time)).toBe(35);
        expect(resposta.body.aviso).toMatch(/Não é diagnóstico clínico/);
    });

    test('envia a janela padrão de 15 min (900 s) e o corte de 10% da IA', async () => {
        const db = criarBancoFalso({ rows: [LINHA_DETALHE] });

        await get(db, '/api/alertas/5');

        expect(db.query).toHaveBeenCalledWith(SQL_DETALHE_ALERTA, [5, 900, 0.1]);
        expect(PROPORCAO_CORTE).toBe(0.1);
    });

    test('respeita IA_JANELA_MINUTOS configurado igual ao da IA', async () => {
        const db = criarBancoFalso({ rows: [LINHA_DETALHE] });

        await get(db, '/api/alertas/5', configTeste({ janelaAnaliseMin: 5 }));

        expect(db.query).toHaveBeenCalledWith(SQL_DETALHE_ALERTA, [5, 300, 0.1]);
    });

    test('404: alerta inexistente', async () => {
        const resposta = await get(criarBancoFalso({ rows: [] }), '/api/alertas/999');

        expect(resposta.status).toBe(404);
        expect(resposta.body).toEqual({ erro: 'Alerta não encontrado' });
    });

    test.each(['abc', '0', '-1', '1.5', '99999999999'])('400: id inválido "%s"', async (id) => {
        const db = criarBancoFalso();

        const resposta = await get(db, `/api/alertas/${id}`);

        expect(resposta.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('401: exige token', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/alertas/5');

        expect(resposta.status).toBe(401);
    });
});

describe('variacaoPercentual', () => {
    test.each([
        [126.6153, 93.87, 34.9],
        [319.6667, 480.39, -33.5],
        [100, 100, 0],
        [null, 100, null],
        [100, 0, null],
        [100, null, null]
    ])('(%p, %p) → %p', (observado, base, esperado) => {
        expect(variacaoPercentual(observado, base)).toBe(esperado);
    });
});

// =====================================================
// Integração com o PostgreSQL real: valida a SQL da janela (transação desfeita no final).
// Pulado quando não há banco configurado (ex.: CI sem PostgreSQL).
// =====================================================

// Mesma regra do percentile_cont do PostgreSQL e do numpy.quantile da IA (interpolação linear)
function quantil(ordenados, p) {
    const posicao = p * (ordenados.length - 1);
    const base = Math.floor(posicao);
    const resto = posicao - base;
    return ordenados[base] + (ordenados[base + 1] !== undefined ? resto * (ordenados[base + 1] - ordenados[base]) : 0);
}

function mediaAparada(valores, proporcao = 0.1) {
    const ordenados = [...valores].sort((a, b) => a - b);
    const [inferior, superior] = [quantil(ordenados, proporcao), quantil(ordenados, 1 - proporcao)];
    const miolo = ordenados.filter((v) => v >= inferior && v <= superior);
    return miolo.reduce((soma, v) => soma + v, 0) / miolo.length;
}

const temBanco = Boolean(process.env.ECOS_DB_PASSWORD);

(temBanco ? describe : describe.skip)('GET /api/alertas/:id no PostgreSQL real', () => {
    const pool = temBanco ? require('../db') : null;

    afterAll(() => pool?.end());

    test('usa só os eventos que a IA avaliou juntos, dentro da janela da anomalia', async () => {
        const cliente = await pool.connect();

        try {
            await cliente.query('BEGIN');

            const coluna = await cliente.query(
                "SELECT 1 FROM information_schema.columns WHERE table_name = 'telemetria' AND column_name = 'analisada_em'"
            );
            if (coluna.rows.length === 0) {
                console.warn('Migração 001 não aplicada; teste de integração ignorado.');
                return;
            }

            const { rows: [colaborador] } = await cliente.query(
                "INSERT INTO colaborador (codigo_anonimo, setor) VALUES ($1, 'Teste API') RETURNING id",
                ['cd'.repeat(16) + 'teste0']
            );
            const { rows: [baseline] } = await cliente.query(
                'INSERT INTO baseline (colaborador_id, media_dwell_time, media_flight_time, media_mouse_speed) VALUES ($1, 95, 90, 480) RETURNING id',
                [colaborador.id]
            );

            // Janela de 15 min alinhada ao relógio, 3 horas atrás
            const inicio = new Date(Math.floor((Date.now() - 3 * 3600e3) / 900e3) * 900e3);
            const execucaoAnterior = new Date(inicio.getTime() + 5 * 60e3);
            const execucaoDoAlerta = new Date(inicio.getTime() + 20 * 60e3);

            async function inserir(segundos, dwell, flight, mouse, analisadaEm) {
                const { rows: [linha] } = await cliente.query(
                    `INSERT INTO telemetria (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta, analisada_em)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                    [colaborador.id, dwell, flight, mouse, new Date(inicio.getTime() + segundos * 1000), analisadaEm]
                );
                return linha.id;
            }

            // Grupo 1: comportamento normal, analisado em uma execução anterior (mesma janela de relógio)
            for (let i = 0; i < 30; i++) await inserir(i * 5, 95, 90, 480, execucaoAnterior);

            // Grupo 2: fadiga, avaliado junto pela IA na execução que gerou o alerta (inclui uma pausa longa)
            const fadiga = Array.from({ length: 40 }, (_, i) => ({
                dwell: 120 + ((i * 7) % 30),
                flight: i === 10 ? 2400 : 150 + ((i * 11) % 60),
                mouse: 300 + ((i * 13) % 50)
            }));
            let ultimoId;
            for (const [i, e] of fadiga.entries()) {
                ultimoId = await inserir(300 + i * 10, e.dwell, e.flight, e.mouse, execucaoDoAlerta);
            }

            // Mesma execução, mas na janela seguinte: não pode entrar
            await inserir(15 * 60 + 1, 999, 999, 1, execucaoDoAlerta);

            const { rows: [anomalia] } = await cliente.query(
                "INSERT INTO anomalia (colaborador_id, telemetria_id, baseline_id, nivel, pontuacao_desvio) VALUES ($1, $2, $3, 'ALTO', 3.1) RETURNING id",
                [colaborador.id, ultimoId, baseline.id]
            );
            const { rows: [alerta] } = await cliente.query(
                "INSERT INTO alerta (anomalia_id, status, mensagem) VALUES ($1, 'PENDENTE', 'teste') RETURNING id",
                [anomalia.id]
            );

            const resposta = await get(cliente, `/api/alertas/${alerta.id}`);

            expect(resposta.status).toBe(200);
            const { observado, variacao_percentual: variacao } = resposta.body.comparacao;

            expect(observado.eventos).toBe(40);
            expect(new Date(observado.janela_inicio).getTime()).toBe(inicio.getTime());
            expect(new Date(observado.janela_fim).getTime()).toBe(inicio.getTime() + 900e3);

            const esperado = {
                dwell_time: mediaAparada(fadiga.map((e) => e.dwell)),
                flight_time: mediaAparada(fadiga.map((e) => e.flight)),
                mouse_speed: mediaAparada(fadiga.map((e) => e.mouse))
            };
            expect(observado.dwell_time).toBeCloseTo(esperado.dwell_time, 2);
            expect(observado.flight_time).toBeCloseTo(esperado.flight_time, 2);
            expect(observado.mouse_speed).toBeCloseTo(esperado.mouse_speed, 2);
            expect(variacao.flight_time).toBe(variacaoPercentual(esperado.flight_time, 90));

            // A pausa de 2,4 s foi descartada pela média aparada
            expect(observado.flight_time).toBeLessThan(250);
        } finally {
            await cliente.query('ROLLBACK');
            cliente.release();
        }
    });
});
