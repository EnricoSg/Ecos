const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { JWT_SECRET, configTeste, configComLimites, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

function login(app, corpo) {
    return request(app).post('/api/login').send(corpo);
}

describe('POST /api/login', () => {
    test('200: credenciais corretas devolvem um JWT válido do RH', async () => {
        const resposta = await login(createApp(criarBancoFalso(), configTeste()), { usuario: 'rh', senha: 'senha-do-rh' });

        expect(resposta.status).toBe(200);
        expect(resposta.body.tipo).toBe('Bearer');
        expect(new Date(resposta.body.expira_em).getTime()).toBeGreaterThan(Date.now());

        const conteudo = jwt.verify(resposta.body.token, JWT_SECRET, { algorithms: ['HS256'] });
        expect(conteudo).toMatchObject({ sub: 'rh', papel: 'RH' });
    });

    test.each([
        ['senha errada', { usuario: 'rh', senha: 'errada' }],
        ['usuário errado', { usuario: 'admin', senha: 'senha-do-rh' }]
    ])('401: %s', async (_, corpo) => {
        const resposta = await login(createApp(criarBancoFalso(), configTeste()), corpo);

        expect(resposta.status).toBe(401);
        expect(resposta.body).toEqual({ erro: 'Credenciais inválidas' });
        expect(resposta.body.token).toBeUndefined();
    });

    test.each([
        ['corpo vazio', {}],
        ['senha ausente', { usuario: 'rh' }],
        ['senha que não é texto', { usuario: 'rh', senha: 123 }]
    ])('400: %s', async (_, corpo) => {
        const resposta = await login(createApp(criarBancoFalso(), configTeste()), corpo);

        expect(resposta.status).toBe(400);
    });

    test.each([
        ['JWT_SECRET', { jwtSegredo: '' }],
        ['RH_SENHA', { rhSenha: '' }]
    ])('503: login desativado sem %s configurado', async (_, extra) => {
        const resposta = await login(createApp(criarBancoFalso(), configTeste(extra)), { usuario: 'rh', senha: '' });

        expect(resposta.status).toBe(503);
    });

    test('429: bloqueia força bruta após o limite de tentativas falhas', async () => {
        const app = createApp(criarBancoFalso(), configComLimites({ loginMaximo: 2 }));

        await login(app, { usuario: 'rh', senha: 'x' });
        await login(app, { usuario: 'rh', senha: 'y' });
        const resposta = await login(app, { usuario: 'rh', senha: 'senha-do-rh' });

        expect(resposta.status).toBe(429);
    });

    test('logins bem-sucedidos não contam para o limite', async () => {
        const app = createApp(criarBancoFalso(), configComLimites({ loginMaximo: 2 }));

        for (let i = 0; i < 3; i++) {
            const resposta = await login(app, { usuario: 'rh', senha: 'senha-do-rh' });
            expect(resposta.status).toBe(200);
        }
    });
});

describe('Middleware JWT nas rotas do Dashboard', () => {
    const app = () => createApp(criarBancoFalso({ rows: [] }), configTeste());

    test('401: sem cabeçalho Authorization', async () => {
        const resposta = await request(app()).get('/api/alertas');

        expect(resposta.status).toBe(401);
        expect(resposta.body).toEqual({ erro: 'Token ausente' });
        expect(resposta.headers['www-authenticate']).toBe('Bearer');
    });

    test('401: token assinado com outro segredo', async () => {
        const token = jwt.sign({ papel: 'RH' }, 'outro-segredo-qualquer-com-32-caracteres', { subject: 'rh' });

        const resposta = await request(app()).get('/api/alertas').set('Authorization', `Bearer ${token}`);

        expect(resposta.status).toBe(401);
        expect(resposta.body).toEqual({ erro: 'Token inválido' });
    });

    test('401: token expirado', async () => {
        const token = jwt.sign({ papel: 'RH', exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);

        const resposta = await request(app()).get('/api/alertas').set('Authorization', `Bearer ${token}`);

        expect(resposta.status).toBe(401);
        expect(resposta.body).toEqual({ erro: 'Token expirado' });
    });

    test('401: rejeita token sem assinatura (alg: none)', async () => {
        const token = jwt.sign({ papel: 'RH' }, null, { algorithm: 'none' });

        const resposta = await request(app()).get('/api/alertas').set('Authorization', `Bearer ${token}`);

        expect(resposta.status).toBe(401);
    });

    test('401: a chave de API do coletor não abre as rotas do Dashboard', async () => {
        const resposta = await request(app()).get('/api/alertas').set('X-API-Key', configTeste().apiKey);

        expect(resposta.status).toBe(401);
    });

    test('fluxo completo: login e depois leitura com o token', async () => {
        const instancia = app();
        const { body } = await login(instancia, { usuario: 'rh', senha: 'senha-do-rh' });

        const resposta = await request(instancia).get('/api/alertas').set('Authorization', `Bearer ${body.token}`);

        expect(resposta.status).toBe(200);
    });

    test.each(['/api/alertas', '/api/anomalias', '/api/setores', '/api/setores/TI/tendencia'])(
        '401: %s exige token',
        async (rota) => {
            const resposta = await request(app()).get(rota);

            expect(resposta.status).toBe(401);
        }
    );

    test('401: PATCH /api/alertas/:id exige token', async () => {
        const resposta = await request(app()).patch('/api/alertas/1').send({ status: 'RESOLVIDO' });

        expect(resposta.status).toBe(401);
    });
});
