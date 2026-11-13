// =====================================================
// ECOS - Preparação da máquina com um comando
//
// Uso (na raiz):  npm run configurar
//   --so-banco           pula a instalação das dependências e só prepara o PostgreSQL
//   --sem-banco          só instala as dependências
//
// O que faz, sempre sem apagar nada:
//   1. npm install na raiz, em api/, coletor/ e frontend/ (só onde ainda falta)
//   2. cria o .venv e instala as dependências da IA (só se faltar)
//   3. conecta no PostgreSQL; se a senha padrão ("postgres") não funcionar, pergunta a senha
//      e grava no .env da raiz (que não vai para o GitHub)
//   4. cria o banco ecos_db e roda database/schema.sql e database/seed.sql, se o banco ainda estiver vazio
// =====================================================

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { carregarConfiguracao, RAIZ } = require('../config/carregar-env');
const { caminhoPython } = require('./iniciar');

const PASTAS_NODE = ['.', 'api', 'coletor', 'frontend'];
const NOME_BANCO_VALIDO = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const TENTATIVAS_SENHA = 3;

function passo(texto) {
    console.log(`\n▶ ${texto}`);
}

function rodar(comando, argumentos, cwd = RAIZ) {
    // shell: true para o npm.cmd do Windows; os argumentos são fixos, nunca vêm do usuário
    const resultado = spawnSync(comando, argumentos, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    return resultado.status === 0;
}

// -----------------------------------------------------
// 1 e 2. Dependências
// -----------------------------------------------------

function instalarDependenciasNode() {
    passo('Dependências do Node');

    for (const pasta of PASTAS_NODE) {
        const nome = pasta === '.' ? 'raiz' : `${pasta}/`;

        if (fs.existsSync(path.join(RAIZ, pasta, 'node_modules'))) {
            console.log(`  ✔ ${nome}: já instaladas`);
            continue;
        }

        console.log(`  … ${nome}: instalando (pode levar alguns minutos)`);
        if (!rodar('npm', ['install'], path.join(RAIZ, pasta))) {
            throw new Error(`"npm install" falhou em ${nome}. Veja as mensagens acima.`);
        }
    }
}

// Python do sistema para CRIAR o .venv (o caminhoPython() devolve o do .venv quando ele já existe)
function pythonDoSistema() {
    const candidatos = process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];

    for (const [comando, prefixo] of candidatos) {
        const teste = spawnSync(comando, [...prefixo, '--version'], { encoding: 'utf8' });
        if (teste.status === 0) return [comando, prefixo];
    }

    return null;
}

function instalarDependenciasPython() {
    passo('Dependências da IA (Python)');

    if (!fs.existsSync(path.join(RAIZ, '.venv'))) {
        const python = pythonDoSistema();
        if (!python) throw new Error('Python 3.10+ não encontrado. Instale em python.org (marque "Add python.exe to PATH") e rode de novo.');

        console.log('  … criando o .venv');
        const [comando, prefixo] = python;
        if (!rodar(comando, [...prefixo, '-m', 'venv', '.venv'])) throw new Error('Não foi possível criar o .venv.');
    }

    const python = caminhoPython();
    const jaInstaladas = spawnSync(python, ['-c', 'import psycopg, pandas, numpy, dotenv'], { stdio: 'ignore' }).status === 0;

    if (jaInstaladas) {
        console.log('  ✔ já instaladas');
        return;
    }

    console.log('  … instalando ai/requirements.txt');
    if (!rodar(python, ['-m', 'pip', 'install', '-r', path.join('ai', 'requirements.txt')])) {
        throw new Error('"pip install" falhou. Veja as mensagens acima.');
    }
}

// -----------------------------------------------------
// 3 e 4. Banco
// -----------------------------------------------------

function perguntarSenha(pergunta) {
    return new Promise((resolve) => {
        const leitor = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        let mostrouPergunta = false;

        // Esconde o que é digitado (mostra * no lugar de cada caractere)
        leitor._writeToOutput = (texto) => {
            if (!mostrouPergunta) {
                mostrouPergunta = true;
                process.stdout.write(texto);
            } else if (texto.includes('\n') || texto.includes('\r')) {
                process.stdout.write('\n');
            } else {
                process.stdout.write('*'.repeat(texto.length));
            }
        };

        leitor.question(pergunta, (resposta) => {
            leitor.close();
            resolve(resposta.trim());
        });
    });
}

// Grava (ou troca) uma variável no .env da raiz, mantendo o resto do arquivo
function gravarNoEnvDaRaiz(chave, valor, arquivo = path.join(RAIZ, '.env')) {
    const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/) : [
        '# Ajustes DESTA máquina (não vai para o GitHub). Os padrões estão em config/desenvolvimento.env.'
    ];
    const nova = `${chave}=${valor}`;
    const indice = linhas.findIndex((linha) => linha.startsWith(`${chave}=`));

    while (linhas.length > 0 && linhas.at(-1) === '') linhas.pop();

    if (indice >= 0) linhas[indice] = nova;
    else linhas.push(nova);

    fs.writeFileSync(arquivo, `${linhas.join('\n')}\n`);
}

function carregarPg() {
    try {
        return require(path.join(RAIZ, 'api', 'node_modules', 'pg'));
    } catch {
        throw new Error('O módulo "pg" não está instalado em api/. Rode "npm run configurar" sem --so-banco.');
    }
}

function dadosDeConexao(env, banco) {
    return {
        host: env.ECOS_DB_HOST || 'localhost',
        port: Number(env.ECOS_DB_PORT || 5432),
        user: env.ECOS_DB_USER || 'postgres',
        password: env.ECOS_DB_PASSWORD || '',
        database: banco,
        connectionTimeoutMillis: 5000
    };
}

// Conecta no banco de manutenção "postgres"; pergunta a senha se a configurada não funcionar
async function conectarServidor(pg, env) {
    for (let tentativa = 0; ; tentativa++) {
        const cliente = new pg.Client(dadosDeConexao(env, 'postgres'));

        try {
            await cliente.connect();
            return { cliente, senhaNova: tentativa > 0 };
        } catch (erro) {
            await cliente.end().catch(() => {});

            if (erro.code === 'ECONNREFUSED' || erro.code === 'ENOTFOUND') {
                throw new Error(
                    `Não foi possível conectar ao PostgreSQL em ${env.ECOS_DB_HOST}:${env.ECOS_DB_PORT}. ` +
                    'Confira se ele está instalado e se o serviço está rodando (Windows: "Serviços" > postgresql).'
                );
            }

            // 28P01 = senha errada; 28000 = usuário sem permissão de login
            if (!['28P01', '28000'].includes(erro.code)) throw erro;
            if (tentativa >= TENTATIVAS_SENHA) throw new Error('Senha do PostgreSQL recusada várias vezes. Rode de novo quando tiver a senha.');

            if (tentativa === 0) {
                console.log(`  A senha configurada não funcionou para o usuário "${env.ECOS_DB_USER}".`);
                console.log('  Digite a senha do PostgreSQL desta máquina (a que você definiu ao instalar).');
            } else {
                console.log('  Senha recusada. Tente de novo.');
            }

            if (!process.stdin.isTTY) throw new Error('Rode "npm run configurar" em um terminal para digitar a senha do PostgreSQL.');
            env.ECOS_DB_PASSWORD = await perguntarSenha('  Senha: ');
        }
    }
}

async function prepararBanco() {
    passo('Banco de dados (PostgreSQL)');

    const env = { ...process.env };
    carregarConfiguracao({ envDoModulo: path.join(RAIZ, 'api', '.env'), env });

    if (env.NODE_ENV === 'production') {
        throw new Error('NODE_ENV=production: este comando é só para máquinas de desenvolvimento.');
    }

    const nomeBanco = env.ECOS_DB_NAME || 'ecos_db';
    if (!NOME_BANCO_VALIDO.test(nomeBanco)) throw new Error(`ECOS_DB_NAME inválido: "${nomeBanco}" (use letras, números e _).`);

    const pg = carregarPg();
    const { cliente: servidor, senhaNova } = await conectarServidor(pg, env);
    console.log(`  ✔ conectado em ${env.ECOS_DB_HOST}:${env.ECOS_DB_PORT} como "${env.ECOS_DB_USER}"`);

    if (senhaNova) {
        gravarNoEnvDaRaiz('ECOS_DB_PASSWORD', env.ECOS_DB_PASSWORD);
        console.log('  ✔ senha guardada no .env da raiz (API e IA passam a usá-la; o arquivo não vai para o GitHub)');
    }

    try {
        const existe = await servidor.query('SELECT 1 FROM pg_database WHERE datname = $1', [nomeBanco]);

        if (existe.rowCount === 0) {
            // Nome já validado pela regex acima: não dá para usar parâmetro ($1) em CREATE DATABASE
            await servidor.query(`CREATE DATABASE "${nomeBanco}"`);
            console.log(`  ✔ banco "${nomeBanco}" criado`);
        } else {
            console.log(`  ✔ banco "${nomeBanco}" já existe`);
        }
    } finally {
        await servidor.end();
    }

    const banco = new pg.Client(dadosDeConexao(env, nomeBanco));
    await banco.connect();

    try {
        const tabela = await banco.query("SELECT to_regclass('public.colaborador') IS NOT NULL AS existe");

        if (tabela.rows[0].existe) {
            console.log('  ✔ tabelas já existem: nada foi alterado');
            return;
        }

        for (const arquivo of ['schema.sql', 'seed.sql']) {
            const sql = fs.readFileSync(path.join(RAIZ, 'database', arquivo), 'utf8');
            await banco.query(sql);
            console.log(`  ✔ database/${arquivo} aplicado`);
        }
    } finally {
        await banco.end();
    }
}

// -----------------------------------------------------
// Execução
// -----------------------------------------------------

async function main() {
    const argumentos = new Set(process.argv.slice(2));
    const desconhecidos = [...argumentos].filter((argumento) => !['--so-banco', '--sem-banco'].includes(argumento));

    if (desconhecidos.length > 0) {
        console.error(`🔴 Opção desconhecida: ${desconhecidos.join(', ')} (use --so-banco ou --sem-banco)`);
        process.exit(1);
    }

    console.log('=== ECOS - Preparando esta máquina ===');

    if (!argumentos.has('--so-banco')) {
        instalarDependenciasNode();
        instalarDependenciasPython();
    }

    if (!argumentos.has('--sem-banco')) await prepararBanco();

    const env = { ...process.env };
    carregarConfiguracao({ envDoModulo: path.join(RAIZ, 'api', '.env'), env });

    console.log('\n🟢 Pronto! Próximos passos:');
    console.log('   npm run demo:dados   # colaboradores e alertas de demonstração (rode de novo na véspera da apresentação)');
    console.log('   npm start            # sobe API, Dashboard, coletor e IA');
    console.log(`   Dashboard: http://localhost:5173  (usuário: ${env.RH_USUARIO}, senha: ${env.RH_SENHA})`);
}

if (require.main === module) {
    main().catch((erro) => {
        console.error(`\n🔴 ${erro.message}`);
        process.exit(1);
    });
}

module.exports = { gravarNoEnvDaRaiz, pythonDoSistema };
