const request = require('supertest');
const { createApp } = require('../app');
const { lerConfig, pendenciasDeConfig } = require('../config');
const { pacoteBase, configTeste, criarBancoFalso, silenciarConsole } = require('./auxiliares');

silenciarConsole();

describe('GET /api/health', () => {
    test('200 quando o banco responde', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/health');

        expect(resposta.status).toBe(200);
        expect(resposta.body).toEqual({ status: 'ok', banco: 'conectado' });
    });

    test('503 quando o banco está indisponível', async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

        const resposta = await request(createApp(db, configTeste())).get('/api/health');

        expect(resposta.status).toBe(503);
    });
});

describe('Configuração HTTP', () => {
    test('CORS autoriza o Dashboard RH (Vite em localhost:5173)', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste()))
            .get('/api/health')
            .set('Origin', 'http://localhost:5173');

        expect(resposta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    test('CORS libera PATCH e Authorization no preflight do Dashboard', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste()))
            .options('/api/alertas/1')
            .set('Origin', 'http://localhost:5173')
            .set('Access-Control-Request-Method', 'PATCH')
            .set('Access-Control-Request-Headers', 'authorization,content-type');

        expect(resposta.status).toBe(204);
        expect(resposta.headers['access-control-allow-methods']).toContain('PATCH');
        expect(resposta.headers['access-control-allow-headers']).toContain('authorization');
    });

    test('404 em rotas inexistentes', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api/nada');

        expect(resposta.status).toBe(404);
    });
});

describe('Configuração por variáveis de ambiente', () => {
    test('lê as variáveis do .env', () => {
        const config = lerConfig({ API_KEY: 'k', RH_USUARIO: 'u', RH_SENHA: 's', JWT_SECRET: 'j', LOTE_MAXIMO: '50' });

        expect(config).toMatchObject({ apiKey: 'k', rhUsuario: 'u', rhSenha: 's', jwtSegredo: 'j', loteMaximo: 50 });
    });

    test('valores numéricos inválidos caem no padrão', () => {
        expect(lerConfig({ LOTE_MAXIMO: 'muitos' }).loteMaximo).toBe(1000);
    });

    test('aponta o que falta configurar', () => {
        expect(pendenciasDeConfig(lerConfig({}))).toHaveLength(3);
        expect(pendenciasDeConfig(configTeste())).toEqual([]);
        expect(pendenciasDeConfig(configTeste({ jwtSegredo: 'curto' }))).toEqual([
            'JWT_SECRET deve ter pelo menos 32 caracteres'
        ]);
    });
});

describe('Documentação Swagger', () => {
    async function especificacao() {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api-docs.json');
        return resposta.body;
    }

    test('GET /api-docs serve a interface do Swagger UI', async () => {
        const resposta = await request(createApp(criarBancoFalso(), configTeste())).get('/api-docs/');

        expect(resposta.status).toBe(200);
        expect(resposta.text).toContain('swagger-ui');
    });

    test('documenta todas as rotas da API', async () => {
        const { paths } = await especificacao();

        expect(Object.keys(paths).sort()).toEqual([
            '/api/alertas',
            '/api/alertas/{id}',
            '/api/anomalias',
            '/api/health',
            '/api/login',
            '/api/setores',
            '/api/setores/{setor}/tendencia',
            '/api/telemetria'
        ]);
    });

    test('define os botões de autorização Bearer (RH) e API Key (coletor)', async () => {
        const { components, paths } = await especificacao();

        expect(components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
        expect(components.securitySchemes.chaveApi).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
        expect(paths['/api/telemetria'].post.security).toEqual([{ chaveApi: [] }]);
        expect(paths['/api/alertas'].get.security).toEqual([{ bearerAuth: [] }]);
    });

    test('POST /api/telemetria documenta o pacote, o lote e todas as respostas', async () => {
        const rota = (await especificacao()).paths['/api/telemetria'].post;

        expect(Object.keys(rota.responses).sort()).toEqual(['201', '400', '401', '404', '413', '429', '500', '503']);
        expect(rota.requestBody.content['application/json'].examples.pacote.value).toEqual(pacoteBase());
    });

    test('todas as referências $ref apontam para componentes definidos', async () => {
        const spec = await especificacao();
        const referencias = JSON.stringify(spec).match(/"\$ref":"#\/[^"]+"/g) || [];

        for (const ref of referencias) {
            const caminho = ref.slice(10, -1).split('/');
            const alvo = caminho.reduce((no, chave) => no?.[chave], spec);
            expect({ ref, existe: alvo !== undefined }).toEqual({ ref, existe: true });
        }
    });
});
