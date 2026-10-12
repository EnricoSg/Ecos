const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { SQL_LISTAR_ALERTAS, SQL_RESOLVER_ALERTA, SQL_STATUS_ALERTA } = require('../rotas/alertas');
const { USER_ID, JWT_SECRET, configTeste, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

const TOKEN = jwt.sign({ papel: 'RH' }, JWT_SECRET, { subject: 'rh', expiresIn: '1h' });

const LINHA_ALERTA = {
    id: 7,
    status: 'PENDENTE',
    mensagem: 'Desvio comportamental de nível alto detectado. Recomenda-se acompanhamento.',
    data_criacao: '2026-10-10T14:00:00.000Z',
    data_resolucao: null,
    anomalia_id: 15,
    nivel: 'ALTO',
    pontuacao_desvio: 0.231456,
    data_deteccao: '2026-10-10T13:59:00.000Z',
    codigo_anonimo: USER_ID,
    setor: 'TI',
    total: 1
};

function get(db, rota) {
    return request(createApp(db, configTeste())).get(rota).set('Authorization', `Bearer ${TOKEN}`);
}

function patch(db, rota, corpo) {
    return request(createApp(db, configTeste())).patch(rota).set('Authorization', `Bearer ${TOKEN}`).send(corpo);
}

describe('GET /api/alertas', () => {
    test('200: devolve alertas com anomalia e colaborador aninhados', async () => {
        const db = criarBancoFalso({ rows: [LINHA_ALERTA] });

        const resposta = await get(db, '/api/alertas');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({
            total: 1,
            pagina: 1,
            limite: 50,
            alertas: [{
                id: 7,
                status: 'PENDENTE',
                mensagem: LINHA_ALERTA.mensagem,
                data_criacao: '2026-10-10T14:00:00.000Z',
                data_resolucao: null,
                anomalia: { id: 15, nivel: 'ALTO', pontuacao_desvio: 0.231456, data_deteccao: '2026-10-10T13:59:00.000Z' },
                colaborador: { codigo_anonimo: USER_ID, setor: 'TI' }
            }]
        });
        expect(db.query).toHaveBeenCalledWith(SQL_LISTAR_ALERTAS, [null, null, 50, 0]);
    });

    test('filtra por status e setor e pagina', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await get(db, '/api/alertas?status=RESOLVIDO&setor=Financeiro&limite=10&pagina=3');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ total: 0, pagina: 3, limite: 10, alertas: [] });
        expect(db.query).toHaveBeenCalledWith(SQL_LISTAR_ALERTAS, ['RESOLVIDO', 'Financeiro', 10, 20]);
    });

    test.each([
        ['status desconhecido', '?status=ABERTO'],
        ['limite acima de 200', '?limite=500'],
        ['página zero', '?pagina=0'],
        ['limite em texto', '?limite=dez'],
        ['status repetido', '?status=PENDENTE&status=RESOLVIDO']
    ])('400: %s', async (_, query) => {
        const db = criarBancoFalso();

        const resposta = await get(db, `/api/alertas${query}`);

        expect(resposta.status).toBe(400);
        expect(resposta.body.erro).toBe('Parâmetro inválido');
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/alertas/:id', () => {
    test('200: marca como RESOLVIDO e devolve a data de resolução', async () => {
        const resolvido = {
            id: 7,
            status: 'RESOLVIDO',
            mensagem: 'Desvio',
            data_criacao: '2026-10-10T14:00:00.000Z',
            data_resolucao: '2026-10-12T15:30:00.000Z'
        };
        const db = criarBancoFalso({ rows: [resolvido] });

        const resposta = await patch(db, '/api/alertas/7', { status: 'RESOLVIDO' });

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ mensagem: 'Alerta marcado como resolvido', alerta: resolvido });
        expect(db.query).toHaveBeenCalledWith(SQL_RESOLVER_ALERTA, [7]);
    });

    test('404: alerta inexistente', async () => {
        const db = criarBancoFalso({ rows: [] }, { rows: [] });

        const resposta = await patch(db, '/api/alertas/999', { status: 'RESOLVIDO' });

        expect(resposta.status).toBe(404);
        expect(resposta.body).toEqual({ erro: 'Alerta não encontrado' });
        expect(db.query).toHaveBeenLastCalledWith(SQL_STATUS_ALERTA, [999]);
    });

    test('409: alerta já resolvido mantém a data original', async () => {
        const db = criarBancoFalso({ rows: [] }, { rows: [{ status: 'RESOLVIDO' }] });

        const resposta = await patch(db, '/api/alertas/7', { status: 'RESOLVIDO' });

        expect(resposta.status).toBe(409);
        expect(resposta.body).toEqual({ erro: 'O alerta já está resolvido' });
    });

    test.each([
        ['id em texto', '/api/alertas/abc', { status: 'RESOLVIDO' }],
        ['id negativo', '/api/alertas/-1', { status: 'RESOLVIDO' }],
        ['id acima do INTEGER do PostgreSQL', '/api/alertas/99999999999', { status: 'RESOLVIDO' }],
        ['corpo sem status', '/api/alertas/7', {}],
        ['tentativa de reabrir', '/api/alertas/7', { status: 'PENDENTE' }]
    ])('400: %s', async (_, rota, corpo) => {
        const db = criarBancoFalso();

        const resposta = await patch(db, rota, corpo);

        expect(resposta.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });
});
