const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const {
    SQL_ANOMALIAS_AGREGADAS, SQL_LISTAR_SETORES, SQL_RESUMO_SETOR, SQL_TENDENCIA_SETOR
} = require('../rotas/analises');
const { JWT_SECRET, configTeste, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

const TOKEN = jwt.sign({ papel: 'RH' }, JWT_SECRET, { subject: 'rh', expiresIn: '1h' });
const DIA_MS = 24 * 60 * 60 * 1000;

function get(db, rota) {
    return request(createApp(db, configTeste())).get(rota).set('Authorization', `Bearer ${TOKEN}`);
}

describe('GET /api/anomalias', () => {
    test('200: série agregada com período e agrupamento informados', async () => {
        const serie = [{ periodo: '2026-10-10T00:00:00.000Z', baixo: 3, medio: 2, alto: 1, total: 6, colaboradores: 2, pontuacao_media: 0.18 }];
        const db = criarBancoFalso({ rows: serie });

        const resposta = await get(db, '/api/anomalias?inicio=2026-10-01&fim=2026-10-12&agrupamento=hora&setor=TI');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({
            inicio: '2026-10-01T00:00:00.000Z',
            fim: '2026-10-12T00:00:00.000Z',
            agrupamento: 'hora',
            setor: 'TI',
            serie
        });
        expect(db.query).toHaveBeenCalledWith(SQL_ANOMALIAS_AGREGADAS, [
            'hour', '2026-10-01T00:00:00.000Z', '2026-10-12T00:00:00.000Z', 'TI'
        ]);
    });

    test('aceita data com hora e fuso horário', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await get(db, '/api/anomalias?inicio=2026-10-01T00:00:00-03:00&fim=2026-10-02T00:00:00Z');

        expect(resposta.status).toBe(200);
        expect(resposta.body.inicio).toBe('2026-10-01T03:00:00.000Z');
    });

    test('padrão: últimos 30 dias agrupados por dia, sem filtro de setor', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await get(db, '/api/anomalias');

        expect(resposta.status).toBe(200);
        expect(resposta.body.agrupamento).toBe('dia');
        expect(new Date(resposta.body.fim) - new Date(resposta.body.inicio)).toBe(30 * DIA_MS);

        const [unidade, , , setor] = db.query.mock.calls[0][1];
        expect(unidade).toBe('day');
        expect(setor).toBeNull();
    });

    test.each([
        ['agrupamento desconhecido', '?agrupamento=mes'],
        ['data inválida', '?inicio=ontem'],
        ['início depois do fim', '?inicio=2026-10-12&fim=2026-10-01'],
        ['período acima de 366 dias', '?inicio=2024-01-01&fim=2026-01-01'],
        ['agrupamento herdado do prototype', '?agrupamento=toString'],
        ['dia que não existe', '?inicio=2026-02-30'],
        ['número solto como data', '?inicio=1&fim=2'],
        ['data sem zero à esquerda', '?inicio=2026-1-5']
    ])('400: %s', async (_, query) => {
        const db = criarBancoFalso();

        const resposta = await get(db, `/api/anomalias${query}`);

        expect(resposta.status).toBe(400);
        expect(resposta.body.erro).toBe('Parâmetro inválido');
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('GET /api/setores', () => {
    test('200: lista setores com colaboradores e alertas pendentes', async () => {
        const setores = [{ setor: 'TI', colaboradores: 2, alertas_pendentes: 3 }];
        const db = criarBancoFalso({ rows: setores });

        const resposta = await get(db, '/api/setores');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ setores });
        expect(db.query).toHaveBeenCalledWith(SQL_LISTAR_SETORES);
    });
});

describe('GET /api/setores/:setor/tendencia', () => {
    test('200: baseline do setor e série temporal', async () => {
        const serie = [{
            periodo: '2026-10-10T00:00:00.000Z',
            media_dwell_time: 121.4,
            media_flight_time: 95.1,
            media_mouse_speed: 390.2,
            eventos: 400,
            colaboradores: 2,
            anomalias: 4
        }];
        const db = criarBancoFalso(
            { rows: [{ colaboradores: 2, media_dwell_time: 98.5, media_flight_time: 71.25, media_mouse_speed: 462 }] },
            { rows: serie }
        );

        const resposta = await get(db, '/api/setores/Recursos%20Humanos/tendencia?inicio=2026-10-01&fim=2026-10-12&agrupamento=semana');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({
            setor: 'Recursos Humanos',
            inicio: '2026-10-01T00:00:00.000Z',
            fim: '2026-10-12T00:00:00.000Z',
            agrupamento: 'semana',
            colaboradores: 2,
            baseline: { media_dwell_time: 98.5, media_flight_time: 71.25, media_mouse_speed: 462 },
            serie
        });
        expect(db.query).toHaveBeenNthCalledWith(1, SQL_RESUMO_SETOR, ['Recursos Humanos']);
        expect(db.query).toHaveBeenNthCalledWith(2, SQL_TENDENCIA_SETOR, [
            'Recursos Humanos', 'week', '2026-10-01T00:00:00.000Z', '2026-10-12T00:00:00.000Z'
        ]);
    });

    test('404: setor sem colaboradores ativos', async () => {
        const db = criarBancoFalso({
            rows: [{ colaboradores: 0, media_dwell_time: null, media_flight_time: null, media_mouse_speed: null }]
        });

        const resposta = await get(db, '/api/setores/Inexistente/tendencia');

        expect(resposta.status).toBe(404);
        expect(resposta.body).toEqual({ erro: 'Setor não encontrado' });
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('400: período inválido não consulta o banco', async () => {
        const db = criarBancoFalso();

        const resposta = await get(db, '/api/setores/TI/tendencia?agrupamento=ano');

        expect(resposta.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});
