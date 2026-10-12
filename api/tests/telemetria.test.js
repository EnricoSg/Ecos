const request = require('supertest');
const { createApp, SQL_INSERIR_TELEMETRIA } = require('../app');

const USER_ID = 'a2a0159acf6ac55f05c0c4d4bdc54004';

function pacoteBase(extra = {}) {
    return {
        userId: USER_ID,
        timestamp: 1790723199823,
        dwellTime: 103,
        flightTime: 68,
        mouseSpeed: 476,
        ...extra
    };
}

// Banco simulado: cada teste define o que a query devolve
function criarBancoFalso(rows = [{ id: 42, data_coleta: '2026-09-29T23:06:39.823Z' }]) {
    return { query: jest.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('POST /api/telemetria', () => {
    test('201: telemetria válida é validada e inserida com os parâmetros do schema', async () => {
        const db = criarBancoFalso();

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase());

        expect(resposta.status).toBe(201);
        expect(resposta.body).toEqual({
            mensagem: 'Telemetria registada com sucesso',
            id: 42,
            data_coleta: '2026-09-29T23:06:39.823Z'
        });
        expect(db.query).toHaveBeenCalledWith(SQL_INSERIR_TELEMETRIA, [
            USER_ID, 103, 68, 476, '2026-09-29T23:06:39.823Z'
        ]);
    });

    test.each([
        ['campo de tecla', { tecla: 'A' }],
        ['texto literal', { texto: 'relatório confidencial' }],
        ['campo desconhecido', { keystrokes: 'senha123' }],
        ['email no userId', { userId: 'joao.silva@empresa.com' }]
    ])('400: bloqueia %s (LGPD) sem tocar no banco', async (_, extra) => {
        const db = criarBancoFalso();

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase(extra));

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'Violação de LGPD' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test.each([
        ['métrica em texto', { dwellTime: '103' }],
        ['métrica negativa', { mouseSpeed: -1 }],
        ['timestamp ausente', { timestamp: undefined }]
    ])('400: rejeita %s sem tocar no banco', async (_, extra) => {
        const db = criarBancoFalso();

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase(extra));

        expect(resposta.status).toBe(400);
        expect(resposta.body.erro).toBe('Estrutura inválida');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: rejeita métricas decimais (as colunas do banco são INTEGER)', async () => {
        const db = criarBancoFalso();

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase({ dwellTime: 72.5 }));

        expect(resposta.status).toBe(400);
        expect(resposta.body.erro).toBe('Estrutura inválida');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: rejeita um array (só é aceite um pacote por pedido)', async () => {
        const db = criarBancoFalso();

        const resposta = await request(createApp(db)).post('/api/telemetria').send([pacoteBase()]);

        expect(resposta.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: rejeita JSON malformado', async () => {
        const resposta = await request(createApp(criarBancoFalso()))
            .post('/api/telemetria')
            .set('Content-Type', 'application/json')
            .send('{"userId": ');

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'JSON malformado' });
    });

    test('400: rejeita pedido sem corpo JSON', async () => {
        const resposta = await request(createApp(criarBancoFalso())).post('/api/telemetria');

        expect(resposta.status).toBe(400);
    });

    test('413: rejeita payloads acima de 10kb', async () => {
        const resposta = await request(createApp(criarBancoFalso()))
            .post('/api/telemetria')
            .send(pacoteBase({ lixo: 'x'.repeat(20 * 1024) }));

        expect(resposta.status).toBe(413);
    });

    test('404: hash anónimo sem colaborador ativo correspondente', async () => {
        const db = criarBancoFalso([]);

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase());

        expect(resposta.status).toBe(404);
        expect(resposta.body).toEqual({ erro: 'Colaborador não encontrado ou inativo' });
    });

    test('500: falha do banco devolve erro genérico sem expor detalhes internos', async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error('password authentication failed for user "postgres"')) };

        const resposta = await request(createApp(db)).post('/api/telemetria').send(pacoteBase());

        expect(resposta.status).toBe(500);
        expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
        expect(JSON.stringify(resposta.body)).not.toContain('postgres');
    });
});

describe('GET /api/health', () => {
    test('200 quando o banco responde', async () => {
        const resposta = await request(createApp(criarBancoFalso())).get('/api/health');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ status: 'ok', banco: 'ligado' });
    });

    test('503 quando o banco está indisponível', async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

        const resposta = await request(createApp(db)).get('/api/health');

        expect(resposta.status).toBe(503);
    });
});

describe('Configuração HTTP', () => {
    test('CORS autoriza o Dashboard RH (Vite em localhost:5173)', async () => {
        const resposta = await request(createApp(criarBancoFalso()))
            .get('/api/health')
            .set('Origin', 'http://localhost:5173');

        expect(resposta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    test('404 em rotas inexistentes', async () => {
        const resposta = await request(createApp(criarBancoFalso())).get('/api/nada');

        expect(resposta.status).toBe(404);
    });
});
