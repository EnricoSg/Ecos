const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { lerConfig, impedeInicio } = require('../config');
const { SQL_RESUMO_SETOR, SQL_ANOMALIAS_AGREGADAS } = require('../rotas/analises');
const { JWT_SECRET, configTeste, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

const TOKEN = jwt.sign({ papel: 'RH' }, JWT_SECRET, { subject: 'rh', expiresIn: '1h' });

describe('Cabeçalhos de segurança (helmet)', () => {
    test('remove o X-Powered-By e adiciona os cabeçalhos de proteção', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/health');

        expect(resposta.headers['x-powered-by']).toBeUndefined();
        expect(resposta.headers['x-content-type-options']).toBe('nosniff');
        expect(resposta.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(resposta.headers['content-security-policy']).toContain("default-src 'self'");
        expect(resposta.headers['strict-transport-security']).toContain('max-age=');
    });

    test('respostas da /api nunca ficam em cache (dados de saúde ocupacional)', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/health');

        expect(resposta.headers['cache-control']).toBe('no-store');
    });

    test('a CSP do helmet não bloqueia o Swagger UI', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api-docs/');

        expect(resposta.status).toBe(200);
        expect(resposta.headers['content-security-policy']).toBeUndefined();
    });
});

describe('Swagger opcional', () => {
    test('DOCS_HABILITADAS=false esconde /api-docs e /api-docs.json', async () => {
        const app = createApp(criarBancoFalso(), configTeste({ docsHabilitadas: false }));

        expect((await request(app).get('/api-docs/')).status).toBe(404);
        expect((await request(app).get('/api-docs.json')).status).toBe(404);
    });
});

describe('Proxy reverso (TRUST_PROXY)', () => {
    test('sem configuração, a API não confia em X-Forwarded-For', () => {
        const app = createApp(criarBancoFalso(), configTeste());

        expect(app.get('trust proxy')).toBe(false);
    });

    test('com TRUST_PROXY=1, o rate limit passa a usar o IP real do cliente', async () => {
        const app = createApp(criarBancoFalso(), configTeste({
            trustProxy: 1,
            limites: { ...configTeste().limites, leituraMaximo: 1 }
        }));
        const pedir = (ip) => request(app).get('/api/setores').set('X-Forwarded-For', ip).set('Authorization', `Bearer ${TOKEN}`);

        expect((await pedir('203.0.113.1')).status).toBe(200);
        expect((await pedir('203.0.113.1')).status).toBe(429);
        // Outro cliente atrás do mesmo proxy não é bloqueado junto
        expect((await pedir('203.0.113.2')).status).toBe(200);
    });
});

describe('Configuração nova', () => {
    test('valores padrão', () => {
        expect(lerConfig({})).toMatchObject({
            ambiente: 'development',
            trustProxy: false,
            docsHabilitadas: true,
            minColaboradoresSetor: 1,
            janelaAnaliseMin: 15
        });
    });

    test.each([
        [undefined, false],
        ['', false],
        ['false', false],
        ['true', 1],
        ['2', 2],
        ['loopback', 'loopback']
    ])('TRUST_PROXY=%p → %p', (valor, esperado) => {
        expect(lerConfig({ TRUST_PROXY: valor }).trustProxy).toBe(esperado);
    });

    test('lê as variáveis novas do .env', () => {
        const config = lerConfig({
            NODE_ENV: 'production',
            DOCS_HABILITADAS: 'false',
            MIN_COLABORADORES_SETOR: '5',
            IA_JANELA_MINUTOS: '5'
        });

        expect(config).toMatchObject({ ambiente: 'production', docsHabilitadas: false, minColaboradoresSetor: 5, janelaAnaliseMin: 5 });
    });
});

describe('Checagem estrita em produção (impedeInicio)', () => {
    const completa = { ...configTeste(), ambiente: 'production' };

    test('produção com tudo configurado sobe', () => {
        expect(impedeInicio(completa, 'senha-do-banco')).toBe(false);
    });

    test.each([
        ['sem API_KEY', { apiKey: '' }, 'senha'],
        ['sem RH_SENHA', { rhSenha: '' }, 'senha'],
        ['sem JWT_SECRET', { jwtSegredo: '' }, 'senha'],
        ['JWT_SECRET curto', { jwtSegredo: 'curto' }, 'senha'],
        ['sem senha do banco', {}, undefined]
    ])('produção %s não sobe', (_, extra, senha) => {
        expect(impedeInicio({ ...completa, ...extra }, senha)).toBe(true);
    });

    test('em desenvolvimento, pendências são só avisos', () => {
        expect(impedeInicio({ ...configTeste({ apiKey: '' }), ambiente: 'development' }, undefined)).toBe(false);
    });
});

describe('Privacidade: setores pequenos (MIN_COLABORADORES_SETOR)', () => {
    const RESUMO = (colaboradores) => ({
        rows: [{ colaboradores, media_dwell_time: 95, media_flight_time: 90, media_mouse_speed: 480 }]
    });

    function get(db, rota, minimo) {
        return request(createApp(db, configTeste({ minColaboradoresSetor: minimo })))
            .get(rota)
            .set('Authorization', `Bearer ${TOKEN}`);
    }

    test('403: tendência de setor com menos colaboradores que o mínimo', async () => {
        const db = criarBancoFalso(RESUMO(3));

        const resposta = await get(db, '/api/setores/TI/tendencia', 5);

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toBe('Grupo pequeno demais');
        expect(resposta.body.detalhe).toContain('pelo menos 5 colaboradores');
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('200: setor que atinge o mínimo', async () => {
        const db = criarBancoFalso(RESUMO(5), { rows: [] });

        const resposta = await get(db, '/api/setores/TI/tendencia', 5);

        expect(resposta.status).toBe(200);
    });

    test('403: anomalias filtradas por setor pequeno', async () => {
        const db = criarBancoFalso(RESUMO(2));

        const resposta = await get(db, '/api/anomalias?setor=TI', 5);

        expect(resposta.status).toBe(403);
        expect(db.query).toHaveBeenCalledWith(SQL_RESUMO_SETOR, ['TI']);
        expect(db.query).not.toHaveBeenCalledWith(SQL_ANOMALIAS_AGREGADAS, expect.anything());
    });

    test('anomalias sem filtro de setor não são bloqueadas', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await get(db, '/api/anomalias', 5);

        expect(resposta.status).toBe(200);
        expect(db.query).not.toHaveBeenCalledWith(SQL_RESUMO_SETOR, expect.anything());
    });

    test('desligado por padrão (1): setor com 1 colaborador é exibido e sem consulta extra', async () => {
        const db = criarBancoFalso({ rows: [] });

        const resposta = await get(db, '/api/anomalias?setor=TI', 1);

        expect(resposta.status).toBe(200);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});
