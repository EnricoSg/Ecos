// =====================================================
// ECOS - Sistema inteiro com um comando
//
// Sobe, na mesma máquina e no mesmo terminal:
//   1. API (api/server.js), se a porta ainda estiver livre
//   2. Dashboard RH (Vite em frontend/)
//   3. Coletor (coletor/index.js): captura real do teclado e mouse, ou o simulador
//   4. Motor de IA (ai/pipeline.py), a cada N minutos
//
// Enter no terminal roda a IA na hora, incluindo a janela em andamento (útil na demonstração).
// Ctrl+C encerra tudo em ordem: coletor (envia o que falta) → IA → API → Dashboard.
//
// Uso (na raiz):  npm start   ou   node scripts/iniciar.js [opções]
//   --modo=real|simulado    fonte do coletor (padrão: real)
//   --perfil=normal|fadiga  perfil do simulador (só com --modo=simulado)
//   --intervalo-ia=5        minutos entre as execuções automáticas da IA
//   --sem-coletor           não sobe o coletor (ex.: máquina que só roda API e IA)
//   --sem-front             não sobe o Dashboard
//   --duracao=60            encerra sozinho depois de N segundos (testes)
// =====================================================

const { fork, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');
const util = require('node:util');

const RAIZ = path.resolve(__dirname, '..');
const PORTA_FRONT = 5173;
const ESPERA_API_MS = 20 * 1000;

// Quanto esperar cada parte encerrar sozinha antes de forçar
const LIMITE_ENCERRAMENTO_MS = { COLETOR: 15 * 1000, IA: 30 * 1000, API: 12 * 1000, FRONT: 5 * 1000 };

// Cores ANSI dos rótulos: ciano, verde, magenta, azul, amarelo
const CORES = { ECOS: 36, API: 32, FRONT: 35, COLETOR: 34, IA: 33 };

const MODOS = ['real', 'simulado'];
const PERFIS = ['normal', 'fadiga'];

// -----------------------------------------------------
// Configuração (funções puras, testadas em tests/iniciar.test.js)
// -----------------------------------------------------

function lerArgumentos(argumentos) {
    const opcoes = { modo: 'real', perfil: 'normal', intervaloIaMin: 5, coletor: true, front: true, duracaoSeg: 0 };
    const erros = [];

    for (const argumento of argumentos) {
        const [chave, valor] = argumento.replace(/^--/, '').split('=');

        if (chave === 'modo') opcoes.modo = valor;
        else if (chave === 'perfil') opcoes.perfil = valor;
        else if (chave === 'intervalo-ia') opcoes.intervaloIaMin = Number(valor);
        else if (chave === 'sem-coletor') opcoes.coletor = false;
        else if (chave === 'sem-front') opcoes.front = false;
        else if (chave === 'duracao') opcoes.duracaoSeg = Number(valor);
        else erros.push(`Opção desconhecida: ${argumento}`);
    }

    if (!MODOS.includes(opcoes.modo)) erros.push(`--modo deve ser um destes: ${MODOS.join(', ')}.`);
    if (!PERFIS.includes(opcoes.perfil)) erros.push(`--perfil deve ser um destes: ${PERFIS.join(', ')}.`);
    if (!(opcoes.intervaloIaMin > 0)) erros.push('--intervalo-ia deve ser um número de minutos maior que zero.');
    if (!(opcoes.duracaoSeg >= 0)) erros.push('--duracao deve ser um número de segundos.');

    return { opcoes, erros };
}

// O Python do ambiente virtual do projeto tem as dependências da IA; sem ele, tenta o do sistema
function caminhoPython(raiz = RAIZ, plataforma = process.platform, existe = fs.existsSync) {
    const venv = plataforma === 'win32'
        ? path.join(raiz, '.venv', 'Scripts', 'python.exe')
        : path.join(raiz, '.venv', 'bin', 'python');

    if (existe(venv)) return venv;
    return plataforma === 'win32' ? 'python' : 'python3';
}

// Lista o que falta instalar ou configurar, com a dica de como resolver
function verificarPrerequisitos(opcoes, raiz = RAIZ, existe = fs.existsSync) {
    const faltando = [];
    const exigir = (relativo, dica) => {
        if (!existe(path.join(raiz, relativo))) faltando.push(`${relativo} não encontrado: ${dica}.`);
    };

    exigir('api/.env', 'copie api/.env.example para api/.env e preencha');
    exigir('api/node_modules', 'rode "npm install" em api/');
    exigir('ai/.env', 'copie ai/.env.example para ai/.env e preencha');

    if (opcoes.coletor) {
        exigir('coletor/.env', 'copie coletor/.env.example para coletor/.env e preencha');
        if (opcoes.modo === 'real') exigir('coletor/node_modules/uiohook-napi', 'rode "npm install" em coletor/');
    }

    if (opcoes.front) exigir('frontend/node_modules/vite/bin/vite.js', 'rode "npm install" em frontend/');

    return faltando;
}

// Saída de uma execução da IA, sem o cabeçalho que se repete a cada poucos minutos.
// Execução sem nenhum evento novo vira uma linha só.
function resumirSaidaIa(linhas) {
    const cabecalho = /^=== ECOS - Detecção|^Janelas de \d+ min \||^=== RESUMO ===/;
    const uteis = linhas.map((linha) => linha.trim()).filter((linha) => linha && !cabecalho.test(linha));

    // "Baseline 12 criado..." é novidade; "Baselines criados: 0" é só o contador do resumo
    if (uteis.includes('Eventos lidos: 0') && !uteis.some((linha) => /^(\[|Baseline \d|Calibração|ERRO)/.test(linha))) {
        return ['Nada novo para analisar (janelas em andamento esperam fechar; Enter analisa agora).'];
    }

    return uteis;
}

// Lê um .env sem colocá-lo no process.env: cada módulo continua carregando o próprio .env
function lerEnv(arquivo) {
    try {
        return util.parseEnv(fs.readFileSync(arquivo, 'utf8'));
    } catch {
        return {};
    }
}

// -----------------------------------------------------
// Saída no terminal
// -----------------------------------------------------

const usarCores = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function rotulo(nome) {
    const texto = `[${nome}]`.padEnd(9);
    return usarCores ? `\x1b[${CORES[nome]}m${texto}\x1b[0m` : texto;
}

function escrever(nome, mensagem) {
    console.log(`${rotulo(nome)} ${mensagem}`);
}

// Cada linha que o processo filho escreve sai com o rótulo dele
function encaminharSaida(nome, filho) {
    for (const fluxo of [filho.stdout, filho.stderr]) {
        if (!fluxo) continue;
        readline.createInterface({ input: fluxo }).on('line', (linha) => {
            if (linha.trim()) escrever(nome, linha);
        });
    }
}

// -----------------------------------------------------
// Processos
// -----------------------------------------------------

const processos = new Map();
let encerrando = false;
let agendador = null;
let leitor = null;

function iniciarProcesso(nome, criar) {
    const filho = criar();
    processos.set(nome, filho);
    encaminharSaida(nome, filho);

    filho.on('error', (erro) => escrever(nome, `🔴 Não foi possível iniciar: ${erro.message}`));
    filho.on('exit', (codigo, sinal) => {
        processos.delete(nome);
        if (!encerrando) escrever(nome, `🟡 Encerrou ${codigo === 0 ? 'normalmente' : `(código ${codigo ?? sinal})`}.`);
    });

    return filho;
}

function terminou(filho) {
    return filho.exitCode !== null || filho.signalCode !== null;
}

// Pede para o processo encerrar (pelo canal IPC, quando existe) e força depois de `limiteMs`.
// Com `pedir: false`, só espera ele terminar sozinho (ex.: a IA no meio de uma análise).
function pararProcesso(filho, limiteMs, { pedir = true } = {}) {
    if (!filho || terminou(filho)) return Promise.resolve();

    return new Promise((resolve) => {
        const forcar = setTimeout(() => filho.kill('SIGKILL'), limiteMs);
        filho.once('exit', () => {
            clearTimeout(forcar);
            resolve();
        });

        if (!pedir) return;
        if (filho.connected) filho.send('encerrar');
        else filho.kill('SIGTERM');
    });
}

function portaAberta(porta, host) {
    return new Promise((resolve) => {
        const conexao = net.connect({ port: porta, host });
        conexao.once('connect', () => {
            conexao.destroy();
            resolve(true);
        });
        conexao.once('error', () => resolve(false));
    });
}

// O Vite escuta em "localhost", que pode ser só IPv6: testa os dois
async function portaEmUso(porta) {
    return (await portaAberta(porta, '127.0.0.1')) || (await portaAberta(porta, '::1'));
}

async function esperarApi(url, limiteMs, processo) {
    const fim = Date.now() + limiteMs;

    while (Date.now() < fim) {
        if (processo && terminou(processo)) return 'encerrou';

        try {
            const resposta = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (resposta.ok) return 'ok';
            if (resposta.status === 503) return 'sem-banco';
        } catch {
            // Ainda subindo
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return 'tempo-esgotado';
}

// Roda a IA a cada `intervaloMin` minutos, nunca duas ao mesmo tempo
function criarAgendadorIa({ python, intervaloMin }) {
    let execucao = null;
    let pedirDeNovo = false;
    let temporizador = null;

    function rodar({ incluirJanelaAberta = false } = {}) {
        if (encerrando) return;

        // Pedido manual durante uma execução: roda de novo logo em seguida
        if (execucao) {
            if (incluirJanelaAberta) pedirDeNovo = true;
            return;
        }

        const argumentos = [path.join(RAIZ, 'ai', 'pipeline.py')];
        if (incluirJanelaAberta) argumentos.push('--incluir-janela-aberta');
        escrever('IA', incluirJanelaAberta ? 'Analisando agora, com a janela em andamento...' : 'Análise periódica...');

        const filho = spawn(python, argumentos, {
            cwd: RAIZ,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
        });
        execucao = filho;

        // A saída normal é resumida no fim da execução; erros (stderr) aparecem na hora
        const linhas = [];
        readline.createInterface({ input: filho.stdout }).on('line', (linha) => linhas.push(linha));
        encaminharSaida('IA', { stderr: filho.stderr });

        const fimDaExecucao = () => {
            if (execucao !== filho) return;
            execucao = null;
            for (const linha of resumirSaidaIa(linhas)) escrever('IA', linha);
            if (pedirDeNovo) {
                pedirDeNovo = false;
                rodar({ incluirJanelaAberta: true });
            }
        };

        filho.on('error', (erro) => {
            escrever('IA', `🔴 Não foi possível rodar o Python (${python}): ${erro.message}. Crie o .venv (veja o README).`);
            fimDaExecucao();
        });
        // 'close' (e não 'exit'): só dispara depois de toda a saída do Python ter sido lida
        filho.on('close', (codigo) => {
            if (codigo && !encerrando) escrever('IA', `🟡 Execução terminou com código ${codigo}.`);
            fimDaExecucao();
        });
    }

    return {
        iniciar() {
            rodar();
            temporizador = setInterval(() => rodar(), intervaloMin * 60 * 1000);
        },
        rodarAgora: () => rodar({ incluirJanelaAberta: true }),
        parar: () => clearInterval(temporizador),
        execucaoAtual: () => execucao
    };
}

async function encerrar(codigo = 0) {
    // Segundo Ctrl+C: não espera mais ninguém
    if (encerrando) {
        for (const filho of processos.values()) filho.kill('SIGKILL');
        process.exit(1);
    }

    encerrando = true;
    escrever('ECOS', 'Encerrando (Ctrl+C de novo força a saída)...');
    agendador?.parar();
    leitor?.close();

    // O coletor sai primeiro: o último lote dele ainda precisa da API no ar
    await pararProcesso(processos.get('COLETOR'), LIMITE_ENCERRAMENTO_MS.COLETOR);
    // Uma análise em andamento termina (e grava) antes da API e do banco saírem
    await pararProcesso(agendador?.execucaoAtual(), LIMITE_ENCERRAMENTO_MS.IA, { pedir: false });
    await pararProcesso(processos.get('API'), LIMITE_ENCERRAMENTO_MS.API);
    await pararProcesso(processos.get('FRONT'), LIMITE_ENCERRAMENTO_MS.FRONT);

    escrever('ECOS', 'Ecos encerrado.');
    process.exit(codigo);
}

// -----------------------------------------------------
// Execução
// -----------------------------------------------------

async function main() {
    const { opcoes, erros } = lerArgumentos(process.argv.slice(2));
    const faltando = erros.length > 0 ? [] : verificarPrerequisitos(opcoes);

    for (const problema of [...erros, ...faltando]) escrever('ECOS', `🔴 ${problema}`);
    if (erros.length > 0 || faltando.length > 0) process.exit(1);

    process.on('SIGINT', () => encerrar(0));
    process.on('SIGTERM', () => encerrar(0));

    const envApi = lerEnv(path.join(RAIZ, 'api', '.env'));
    const portaApi = Number(envApi.PORT || 3000);

    const partes = ['API'];
    if (opcoes.front) partes.push('Dashboard');
    if (opcoes.coletor) {
        partes.push(opcoes.modo === 'real' ? 'coletor (captura real)' : `coletor (simulador, perfil ${opcoes.perfil})`);
    }
    partes.push(`IA a cada ${opcoes.intervaloIaMin} min`);
    escrever('ECOS', `Iniciando: ${partes.join(' · ')}`);

    // 1. API
    if (await portaEmUso(portaApi)) {
        escrever('ECOS', `Porta ${portaApi} já está em uso: usando a API que já está rodando.`);
    } else {
        const api = iniciarProcesso('API', () => fork(path.join(RAIZ, 'api', 'server.js'), [], {
            cwd: path.join(RAIZ, 'api'),
            silent: true
        }));
        const situacao = await esperarApi(`http://127.0.0.1:${portaApi}/api/health`, ESPERA_API_MS, api);

        if (situacao === 'encerrou') {
            escrever('ECOS', '🔴 A API não subiu (veja as mensagens acima).');
            return encerrar(1);
        }
        if (situacao === 'sem-banco') escrever('ECOS', '🟡 A API subiu, mas sem acesso ao PostgreSQL. Confira se o serviço do banco está rodando.');
        if (situacao === 'tempo-esgotado') escrever('ECOS', '🟡 A API está demorando para responder; seguindo mesmo assim.');
    }

    // 2. Dashboard (porta fixa: o CORS da API só libera esta origem)
    if (opcoes.front) {
        if (await portaEmUso(PORTA_FRONT)) {
            escrever('ECOS', `Porta ${PORTA_FRONT} já está em uso: usando o Dashboard que já está rodando.`);
        } else {
            iniciarProcesso('FRONT', () => spawn(
                process.execPath,
                [path.join(RAIZ, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORTA_FRONT), '--strictPort'],
                {
                    cwd: path.join(RAIZ, 'frontend'),
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: { ...process.env, FORCE_COLOR: usarCores ? '1' : '0' }
                }
            ));
        }
    }

    // 3. Coletor
    if (opcoes.coletor) {
        const argumentos = [`--modo=${opcoes.modo}`];
        if (opcoes.modo === 'simulado') argumentos.push(`--perfil=${opcoes.perfil}`);

        iniciarProcesso('COLETOR', () => fork(path.join(RAIZ, 'coletor', 'index.js'), argumentos, {
            cwd: path.join(RAIZ, 'coletor'),
            silent: true
        }));
    }

    // 4. IA
    agendador = criarAgendadorIa({ python: caminhoPython(), intervaloMin: opcoes.intervaloIaMin });
    agendador.iniciar();

    escrever('ECOS', `🟢 Dashboard: http://localhost:${PORTA_FRONT} (usuário: ${envApi.RH_USUARIO || 'RH_USUARIO do api/.env'}, senha: RH_SENHA do api/.env)`);
    escrever('ECOS', 'Enter = rodar a IA agora (inclui a janela em andamento) · Ctrl+C = encerrar tudo');

    leitor = readline.createInterface({ input: process.stdin });
    leitor.on('line', () => agendador.rodarAgora());

    if (opcoes.duracaoSeg) setTimeout(() => encerrar(0), opcoes.duracaoSeg * 1000);
}

if (require.main === module) {
    main().catch((erro) => {
        escrever('ECOS', `🔴 Falha inesperada: ${erro.message}`);
        encerrar(1);
    });
}

module.exports = { lerArgumentos, caminhoPython, verificarPrerequisitos, lerEnv, resumirSaidaIa };
