// Carrega a configuração dos módulos em Node (API, coletor e scripts) sem exigir .env.
//
// Ordem (a primeira fonte que definir a variável vence; nada já definido é sobrescrito):
//   1. variáveis do sistema
//   2. .env do módulo (ex.: api/.env), se existir
//   3. .env da raiz do projeto, se existir (ajustes desta máquina)
//   4. config/desenvolvimento.env, só fora de produção
//
// A mesma regra está em ai/banco.py, para a IA enxergar os mesmos valores.

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const RAIZ = path.resolve(__dirname, '..');
const ARQUIVO_PADRAO = path.join(RAIZ, 'config', 'desenvolvimento.env');

function lerArquivoEnv(arquivo) {
    try {
        return util.parseEnv(fs.readFileSync(arquivo, 'utf8'));
    } catch (erro) {
        if (erro.code === 'ENOENT') return {};
        throw erro;
    }
}

// Copia para `env` só as variáveis que ainda não existem
function completar(env, valores) {
    for (const [chave, valor] of Object.entries(valores)) {
        if (env[chave] === undefined) env[chave] = valor;
    }
}

/**
 * @param {object} opcoes
 * @param {string} [opcoes.envDoModulo] caminho do .env do módulo (ex.: api/.env)
 * @param {object} [opcoes.env] objeto a preencher (padrão: process.env)
 * @param {string} [opcoes.raiz] raiz do projeto (para testes)
 * @returns {{ producao: boolean, usouPadrao: boolean }}
 */
function carregarConfiguracao({ envDoModulo, env = process.env, raiz = RAIZ } = {}) {
    if (envDoModulo) completar(env, lerArquivoEnv(envDoModulo));
    completar(env, lerArquivoEnv(path.join(raiz, '.env')));

    // NODE_ENV pode ter vindo do sistema ou de um dos .env acima
    const producao = env.NODE_ENV === 'production';
    if (!producao) completar(env, lerArquivoEnv(path.join(raiz, 'config', 'desenvolvimento.env')));

    return { producao, usouPadrao: !producao };
}

module.exports = { carregarConfiguracao, lerArquivoEnv, RAIZ, ARQUIVO_PADRAO };
