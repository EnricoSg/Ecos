const request = require('supertest');
const { createApp } = require('../app');
const { SQL_INSERIR_TELEMETRIA } = require('../rotas/telemetria');
const {
    USER_ID, API_KEY, pacoteBase, configTeste, configComLimites, criarBancoFalso, silenciarConsole
} = require('./auxiliares');

silenciarConsole();

const INSERIDO = { rows: [{ id: 42, data_coleta: '2026-09-29T23:06:39.823Z' }] };

function enviar(app, corpo, chave = API_KEY) {
    const requisicao = request(app).post('/api/telemetria');
    if (chave) requisicao.set('X-API-Key', chave);
    return corpo === undefined ? requisicao : requisicao.send(corpo);
}

describe('POST /api/telemetria: pacote único', () => {
    test('201: telemetria válida é validada e inserida com os parâmetros do schema', async () => {
        const db = criarBancoFalso(INSERIDO);

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase());

        expect(resposta.status).toBe(201);
        expect(resposta.body).toEqual({
            mensagem: 'Telemetria registrada com sucesso',
            id: 42,
            data_coleta: '2026-09-29T23:06:39.823Z'
        });
        expect(db.query).toHaveBeenCalledWith(SQL_INSERIR_TELEMETRIA, [
            [USER_ID], [103], [68], [476], ['2026-09-29T23:06:39.823Z']
        ]);
    });

    test.each([
        ['campo de tecla', { tecla: 'A' }],
        ['texto literal', { texto: 'relatório confidencial' }],
        ['campo desconhecido', { keystrokes: 'senha123' }],
        ['email no userId', { userId: 'joao.silva@empresa.com' }]
    ])('400: bloqueia %s (LGPD) sem tocar no banco', async (_, extra) => {
        const db = criarBancoFalso();

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase(extra));

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

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase(extra));

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'Estrutura inválida' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: rejeita métricas decimais (as colunas do banco são INTEGER)', async () => {
        const db = criarBancoFalso();

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase({ dwellTime: 72.5 }));

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'Estrutura inválida', detalhe: 'As métricas devem ser números inteiros.' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: rejeita JSON malformado', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste()))
            .post('/api/telemetria')
            .set('X-API-Key', API_KEY)
            .set('Content-Type', 'application/json')
            .send('{"userId": ');

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'JSON malformado' });
    });

    test('400: rejeita requisição sem corpo JSON', async () => {
        const resposta = await enviar(createApp(criarBancoFalso(), configTeste()));

        expect(resposta.status).toBe(400);
    });

    test('413: rejeita payloads acima de 256kb', async () => {
        const app = createApp(criarBancoFalso(), configTeste());

        const resposta = await enviar(app, pacoteBase({ lixo: 'x'.repeat(300 * 1024) }));

        expect(resposta.status).toBe(413);
        expect(resposta.body).toEqual({ erro: 'Payload muito grande' });
    });

    test('404: hash anônimo sem colaborador ativo correspondente', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase());

        expect(resposta.status).toBe(404);
        expect(resposta.body).toEqual({ erro: 'Colaborador não encontrado ou inativo' });
    });

    test('500: falha do banco devolve erro genérico sem expor detalhes internos', async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error('password authentication failed for user "postgres"')) };

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase());

        expect(resposta.status).toBe(500);
        expect(resposta.body).toEqual({ erro: 'Erro interno do servidor' });
        expect(JSON.stringify(resposta.body)).not.toContain('postgres');
    });
});

describe('POST /api/telemetria: lote', () => {
    test('201: grava o lote inteiro em uma única query', async () => {
        const db = criarBancoFalso({
            rows: [
                { id: 42, data_coleta: '2026-09-29T23:06:39.823Z' },
                { id: 43, data_coleta: '2026-09-29T23:06:40.310Z' }
            ]
        });
        const lote = [pacoteBase(), pacoteBase({ timestamp: 1790723200310, dwellTime: 97, flightTime: 74, mouseSpeed: 455 })];

        const resposta = await enviar(createApp(db, configTeste()), lote);

        expect(resposta.status).toBe(201);
        expect(resposta.body).toEqual({
            mensagem: 'Lote de telemetria registrado com sucesso',
            quantidade: 2,
            ids: [42, 43]
        });
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query).toHaveBeenCalledWith(SQL_INSERIR_TELEMETRIA, [
            [USER_ID, USER_ID],
            [103, 97],
            [68, 74],
            [476, 455],
            ['2026-09-29T23:06:39.823Z', '2026-09-29T23:06:40.310Z']
        ]);
    });

    test('400: um pacote com violação de LGPD rejeita o lote inteiro e indica o índice', async () => {
        const db = criarBancoFalso();
        const lote = [pacoteBase(), pacoteBase(), pacoteBase({ tecla: 'A' })];

        const resposta = await enviar(createApp(db, configTeste()), lote);

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'Violação de LGPD', indice: 2 });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('400: métrica decimal no lote indica o índice', async () => {
        const resposta = await enviar(createApp(criarBancoFalso(), configTeste()), [pacoteBase({ mouseSpeed: 1.5 })]);

        expect(resposta.status).toBe(400);
        expect(resposta.body.indice).toBe(0);
    });

    test('400: rejeita lote vazio', async () => {
        const resposta = await enviar(createApp(criarBancoFalso(), configTeste()), []);

        expect(resposta.status).toBe(400);
        expect(resposta.body).toEqual({ erro: 'Lote vazio' });
    });

    test('413: rejeita lote acima do limite de pacotes', async () => {
        const db = criarBancoFalso();
        const app = createApp(db, configTeste({ loteMaximo: 3 }));

        const resposta = await enviar(app, Array.from({ length: 4 }, () => pacoteBase()));

        expect(resposta.status).toBe(413);
        expect(resposta.body.erro).toBe('Lote muito grande');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('aceita 1000 pacotes dentro do limite de 256kb', async () => {
        const lote = Array.from({ length: 1000 }, (_, i) => pacoteBase({ timestamp: 1790723199823 + i }));
        const db = criarBancoFalso({ rows: lote.map((_, i) => ({ id: i + 1 })) });

        const resposta = await enviar(createApp(db, configTeste()), lote);

        expect(resposta.status).toBe(201);
        expect(resposta.body.quantidade).toBe(1000);
    });

    test('404: hash desconhecido no lote não grava nada', async () => {
        const app = createApp(criarBancoFalso({ rows: [] }), configTeste());

        const resposta = await enviar(app, [pacoteBase(), pacoteBase()]);

        expect(resposta.status).toBe(404);
    });
});

describe('POST /api/telemetria: chave de API', () => {
    test('401: sem cabeçalho X-API-Key', async () => {
        const db = criarBancoFalso();

        const resposta = await enviar(createApp(db, configTeste()), pacoteBase(), null);

        expect(resposta.status).toBe(401);
        expect(resposta.body).toEqual({ erro: 'Chave de API inválida ou ausente' });
        expect(db.query).not.toHaveBeenCalled();
    });

    test('401: chave incorreta', async () => {
        const resposta = await enviar(createApp(criarBancoFalso(), configTeste()), pacoteBase(), 'chave-errada');

        expect(resposta.status).toBe(401);
    });

    test('503: rota fechada quando API_KEY não está configurada', async () => {
        const resposta = await enviar(createApp(criarBancoFalso(), configTeste({ apiKey: '' })), pacoteBase(), null);

        expect(resposta.status).toBe(503);
    });

    test('um token JWT do RH não substitui a chave de API', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste()))
            .post('/api/telemetria')
            .set('Authorization', 'Bearer qualquer')
            .send(pacoteBase());

        expect(resposta.status).toBe(401);
    });
});

describe('POST /api/telemetria: rate limit', () => {
    test('429 ao passar do limite de requisições', async () => {
        const app = createApp(criarBancoFalso(INSERIDO), configComLimites({ telemetriaMaximo: 2 }));

        await enviar(app, pacoteBase());
        await enviar(app, pacoteBase());
        const resposta = await enviar(app, pacoteBase());

        expect(resposta.status).toBe(429);
        expect(resposta.body).toEqual({ erro: 'Muitas requisições. Tente novamente mais tarde.' });
    });
});
