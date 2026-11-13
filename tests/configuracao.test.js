const fs = require('fs');
const os = require('os');
const path = require('path');
const { carregarConfiguracao, lerArquivoEnv, ARQUIVO_PADRAO } = require('../config/carregar-env');
const { gravarNoEnvDaRaiz } = require('../scripts/configurar');

// Projeto falso em uma pasta temporária, com os .env que cada teste precisar
function criarProjeto({ padrao = '', raiz = null, modulo = null } = {}) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-config-'));
    fs.mkdirSync(path.join(pasta, 'config'));
    fs.mkdirSync(path.join(pasta, 'api'));
    fs.writeFileSync(path.join(pasta, 'config', 'desenvolvimento.env'), padrao);
    if (raiz !== null) fs.writeFileSync(path.join(pasta, '.env'), raiz);
    if (modulo !== null) fs.writeFileSync(path.join(pasta, 'api', '.env'), modulo);
    return pasta;
}

describe('Configuração sem .env (config/carregar-env.js)', () => {
    test('sem nenhum .env, valem os padrões de desenvolvimento', () => {
        const raiz = criarProjeto({ padrao: 'RH_SENHA=padrao\nAPI_KEY=chave-padrao\n' });
        const env = {};

        expect(carregarConfiguracao({ envDoModulo: path.join(raiz, 'api', '.env'), env, raiz })).toEqual({ producao: false, usouPadrao: true });
        expect(env).toEqual({ RH_SENHA: 'padrao', API_KEY: 'chave-padrao' });
    });

    test('ordem: sistema > .env do módulo > .env da raiz > padrão', () => {
        const raiz = criarProjeto({
            padrao: 'A=padrao\nB=padrao\nC=padrao\nD=padrao\n',
            raiz: 'A=raiz\nB=raiz\nC=raiz\n',
            modulo: 'A=modulo\nB=modulo\n'
        });
        const env = { A: 'sistema' };

        carregarConfiguracao({ envDoModulo: path.join(raiz, 'api', '.env'), env, raiz });

        expect(env).toEqual({ A: 'sistema', B: 'modulo', C: 'raiz', D: 'padrao' });
    });

    test('em produção os padrões de desenvolvimento são ignorados', () => {
        const raiz = criarProjeto({ padrao: 'RH_SENHA=padrao\nJWT_SECRET=segredo-publico\n' });
        const env = { NODE_ENV: 'production' };

        expect(carregarConfiguracao({ env, raiz }).producao).toBe(true);
        expect(env).toEqual({ NODE_ENV: 'production' });
    });

    test('NODE_ENV=production vindo de um .env também desliga os padrões', () => {
        const raiz = criarProjeto({ padrao: 'RH_SENHA=padrao\n', modulo: 'NODE_ENV=production\n' });
        const env = {};

        carregarConfiguracao({ envDoModulo: path.join(raiz, 'api', '.env'), env, raiz });

        expect(env.RH_SENHA).toBeUndefined();
    });

    test('o arquivo de padrões do projeto tem tudo o que API, coletor e IA exigem', () => {
        const padrao = lerArquivoEnv(ARQUIVO_PADRAO);

        for (const chave of ['ECOS_DB_PASSWORD', 'ECOS_DB_NAME', 'API_KEY', 'RH_USUARIO', 'RH_SENHA', 'USER_ID', 'API_URL']) {
            expect(padrao[chave]).toBeTruthy();
        }
        expect(padrao.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
        expect(padrao.NODE_ENV).not.toBe('production');
    });
});

describe('npm run configurar: senha guardada no .env da raiz', () => {
    test('cria o arquivo quando ele não existe', () => {
        const arquivo = path.join(criarProjeto(), '.env');

        gravarNoEnvDaRaiz('ECOS_DB_PASSWORD', 'minha-senha', arquivo);

        expect(lerArquivoEnv(arquivo)).toEqual({ ECOS_DB_PASSWORD: 'minha-senha' });
    });

    test('troca só a variável pedida e mantém o resto', () => {
        const arquivo = path.join(criarProjeto({ raiz: '# comentário\nPORT=4000\nECOS_DB_PASSWORD=antiga\n\n' }), '.env');

        gravarNoEnvDaRaiz('ECOS_DB_PASSWORD', 'nova', arquivo);

        expect(fs.readFileSync(arquivo, 'utf8')).toBe('# comentário\nPORT=4000\nECOS_DB_PASSWORD=nova\n');
    });
});
