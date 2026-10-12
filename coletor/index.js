// =====================================================
// ECOS - Módulo Coletor (Simulador MVP)
//
// Gera métricas comportamentais realistas (dwellTime, flightTime, mouseSpeed),
// acumula os eventos em memória e envia em lote para a API do Ecos.
//
// LGPD por design: este módulo NUNCA captura, recebe ou guarda qual tecla foi
// pressionada, o texto digitado, a posição do cursor, janelas abertas ou qualquer
// outro conteúdo. Ele só conhece TEMPOS e VELOCIDADE. Quando o simulador for trocado
// por uma captura real (ex.: uiohook-napi), o código da tecla deve ser descartado
// no próprio callback do sistema operacional, antes de chegar a este arquivo.
// =====================================================

const path = require('path');

// Únicos campos que podem sair desta máquina (mesma lista branca do validador da API)
const CAMPOS_PERMITIDOS = Object.freeze(['userId', 'timestamp', 'dwellTime', 'flightTime', 'mouseSpeed']);

// Limite de pacotes por requisição aceito pela API (LOTE_MAXIMO)
const LOTE_MAXIMO_API = 1000;

// Espera entre tentativas após falha de rede, 429 ou 5xx (dobra a cada falha, até o teto)
const ESPERA_INICIAL_MS = 5000;
const ESPERA_MAXIMA_MS = 60000;

// -----------------------------------------------------
// Perfis de comportamento
//
// Tempos de digitação seguem uma distribuição log-normal (assimétrica: a maioria das
// teclas é rápida, algumas são bem mais lentas), como observado em estudos de
// keystroke dynamics. O flightTime inclui pausas ocasionais de "pensar".
// O perfil "fadiga" deixa a digitação mais lenta e irregular e o mouse mais lento,
// útil para testar o motor de IA.
// -----------------------------------------------------
const PERFIS = Object.freeze({
    normal: {
        dwell: { mediana: 95, dispersao: 0.22, minimo: 40, maximo: 300 },
        flight: { mediana: 85, dispersao: 0.35, minimo: 15, maximo: 800 },
        pausa: { probabilidade: 0.04, minimo: 500, maximo: 2500 },
        mouse: { media: 480, desvio: 110, minimo: 50, maximo: 1500 }
    },
    fadiga: {
        dwell: { mediana: 135, dispersao: 0.32, minimo: 50, maximo: 450 },
        flight: { mediana: 160, dispersao: 0.45, minimo: 20, maximo: 1200 },
        pausa: { probabilidade: 0.10, minimo: 800, maximo: 4000 },
        mouse: { media: 320, desvio: 120, minimo: 30, maximo: 1200 }
    }
});

// -----------------------------------------------------
// Configuração
// -----------------------------------------------------
function carregarEnv(arquivo = path.join(__dirname, '.env')) {
    try {
        process.loadEnvFile(arquivo);
    } catch (erro) {
        // Sem .env, valem as variáveis já definidas no sistema
        if (erro.code !== 'ENOENT') throw erro;
    }
}

function lerNumero(valor, padrao) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

function lerConfig(env = process.env) {
    return {
        apiUrl: env.API_URL || 'http://localhost:3000/api/telemetria',
        apiKey: env.API_KEY || '',
        userId: env.USER_ID || '',
        perfil: env.PERFIL || 'normal',
        tamanhoLote: Math.min(lerNumero(env.TAMANHO_LOTE, 20), LOTE_MAXIMO_API),
        intervaloEnvioMs: lerNumero(env.INTERVALO_ENVIO_MS, 5000),
        filaMaxima: lerNumero(env.FILA_MAXIMA, 5000),
        timeoutMs: lerNumero(env.TIMEOUT_MS, 10000),
        duracaoSeg: 0
    };
}

// Argumentos de linha de comando sobrescrevem o .env: --perfil=fadiga --duracao=30
function aplicarArgumentos(config, argumentos) {
    const resultado = { ...config };

    for (const argumento of argumentos) {
        const [chave, valor] = argumento.replace(/^--/, '').split('=');
        if (chave === 'perfil' && valor) resultado.perfil = valor;
        if (chave === 'duracao') resultado.duracaoSeg = lerNumero(valor, 0);
    }

    return resultado;
}

function validarConfig(config) {
    const erros = [];

    if (!config.apiKey) erros.push('API_KEY não definida (copie o valor de api/.env).');
    if (!/^[a-f0-9]{32,64}$/i.test(config.userId)) erros.push('USER_ID deve ser o hash anônimo do colaborador (hexadecimal).');
    if (!Object.hasOwn(PERFIS, config.perfil)) erros.push(`PERFIL deve ser um destes: ${Object.keys(PERFIS).join(', ')}.`);

    try {
        new URL(config.apiUrl);
    } catch {
        erros.push('API_URL não é uma URL válida.');
    }

    return erros;
}

// -----------------------------------------------------
// Simulador de métricas
// -----------------------------------------------------

// Normal padrão pelo método de Box-Muller
function normalPadrao(aleatorio) {
    const u = 1 - aleatorio(); // evita log(0)
    const v = aleatorio();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function limitar(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
}

function logNormal({ mediana, dispersao, minimo, maximo }, aleatorio) {
    return limitar(mediana * Math.exp(dispersao * normalPadrao(aleatorio)), minimo, maximo);
}

// Gera as métricas de UMA tecla. Repare que nada aqui sabe qual tecla foi:
// o "evento" é apenas um conjunto de três números.
function gerarMetricas(perfil, aleatorio = Math.random) {
    const dwellTime = logNormal(perfil.dwell, aleatorio);

    let flightTime = logNormal(perfil.flight, aleatorio);
    if (aleatorio() < perfil.pausa.probabilidade) {
        flightTime += perfil.pausa.minimo + aleatorio() * (perfil.pausa.maximo - perfil.pausa.minimo);
    }

    const { media, desvio, minimo, maximo } = perfil.mouse;
    const mouseSpeed = limitar(media + desvio * normalPadrao(aleatorio), minimo, maximo);

    // A API exige inteiros (as colunas do banco são INTEGER)
    return {
        dwellTime: Math.round(dwellTime),
        flightTime: Math.round(flightTime),
        mouseSpeed: Math.round(mouseSpeed)
    };
}

// Dispara um evento a cada "tecla" simulada, no ritmo do próprio evento
// (tempo pressionada + intervalo até a próxima), como uma pessoa digitando.
function iniciarSimulador(perfil, aoGerarEvento, aleatorio = Math.random) {
    let temporizador = null;
    let ativo = true;

    function proximaTecla() {
        if (!ativo) return;

        const metricas = gerarMetricas(perfil, aleatorio);
        aoGerarEvento(metricas, Date.now());

        temporizador = setTimeout(proximaTecla, metricas.dwellTime + metricas.flightTime);
    }

    proximaTecla();

    return {
        parar() {
            ativo = false;
            clearTimeout(temporizador);
        }
    };
}

// -----------------------------------------------------
// Pacote e envio em lote
// -----------------------------------------------------

// Monta o pacote copiando SOMENTE os campos da lista branca. Mesmo que alguém
// acrescente outro campo às métricas no futuro, ele não sai desta máquina.
function montarPacote(userId, metricas, timestamp) {
    const candidato = { userId, timestamp, ...metricas };
    const pacote = {};

    for (const campo of CAMPOS_PERMITIDOS) {
        pacote[campo] = candidato[campo];
    }

    return pacote;
}

function criarColetor({ config, enviar = fetch, log = console, agora = Date.now }) {
    const fila = [];
    const estatisticas = { gerados: 0, enviados: 0, descartados: 0, lotes: 0, falhas: 0 };
    let enviando = false;
    let espera = 0;
    let proximaTentativa = 0;
    let avisouFilaCheia = false;
    let chaveRejeitada = false;

    function registrarEvento(metricas, timestamp) {
        fila.push(montarPacote(config.userId, metricas, timestamp));
        estatisticas.gerados++;

        // Sem conexão por muito tempo: descarta os eventos mais antigos para não esgotar a memória
        if (fila.length > config.filaMaxima) {
            fila.shift();
            estatisticas.descartados++;
            if (!avisouFilaCheia) {
                log.warn(`🟡 [COLETOR] Fila cheia (${config.filaMaxima}). Eventos mais antigos estão sendo descartados.`);
                avisouFilaCheia = true;
            }
        }

        if (fila.length >= config.tamanhoLote) {
            descarregar();
        }
    }

    function agendarNovaTentativa(motivo, quantidade) {
        espera = espera ? Math.min(espera * 2, ESPERA_MAXIMA_MS) : ESPERA_INICIAL_MS;
        proximaTentativa = agora() + espera;
        estatisticas.falhas++;
        log.warn(`🟡 [COLETOR] ${motivo}. ${quantidade} eventos voltaram para a fila; nova tentativa em ${espera / 1000}s.`);
    }

    // Envia o que estiver na fila. Devolve o resultado para facilitar testes e o encerramento.
    // `forcar` ignora a espera entre tentativas (usado ao encerrar o coletor).
    async function descarregar({ forcar = false } = {}) {
        if (enviando || fila.length === 0 || chaveRejeitada) return 'ignorado';
        if (!forcar && agora() < proximaTentativa) return 'aguardando';

        enviando = true;
        const lote = fila.splice(0, LOTE_MAXIMO_API);

        try {
            const resposta = await enviar(config.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
                body: JSON.stringify(lote),
                signal: AbortSignal.timeout(config.timeoutMs)
            });
            const corpo = await resposta.json().catch(() => ({}));

            if (resposta.status === 201) {
                espera = 0;
                proximaTentativa = 0;
                estatisticas.enviados += lote.length;
                estatisticas.lotes++;
                log.log(`🟢 [COLETOR] Lote enviado: ${lote.length} eventos gravados (ids ${corpo.ids?.[0]}…${corpo.ids?.at(-1)}).`);
                return 'enviado';
            }

            // Erros temporários: o lote volta para o início da fila, na ordem original
            if (resposta.status === 429 || resposta.status >= 500) {
                fila.unshift(...lote);
                agendarNovaTentativa(`API respondeu ${resposta.status} (${corpo.erro || 'sem detalhe'})`, lote.length);
                return 'reenfileirado';
            }

            // Chave errada não se resolve tentando de novo: para de enviar e avisa
            if (resposta.status === 401) {
                fila.unshift(...lote);
                chaveRejeitada = true;
                log.error('🔴 [COLETOR] API_KEY rejeitada pela API (401). Confira o valor em coletor/.env.');
                return 'chave_rejeitada';
            }

            // 400, 404, 413: o lote nunca será aceito como está. Descarta para não travar a fila.
            estatisticas.descartados += lote.length;
            log.error(`🔴 [COLETOR] Lote de ${lote.length} eventos descartado: ${resposta.status} ${corpo.erro || ''}` +
                (corpo.indice !== undefined ? ` (pacote ${corpo.indice})` : ''));
            return 'descartado';
        } catch (erro) {
            fila.unshift(...lote);
            const motivo = erro.name === 'TimeoutError' ? 'Tempo de resposta esgotado' : `API inacessível (${erro.cause?.code || erro.message})`;
            agendarNovaTentativa(motivo, lote.length);
            return 'reenfileirado';
        } finally {
            enviando = false;
        }
    }

    return {
        registrarEvento,
        descarregar,
        estatisticas,
        tamanhoFila: () => fila.length,
        chaveFoiRejeitada: () => chaveRejeitada
    };
}

// -----------------------------------------------------
// Execução
// -----------------------------------------------------
async function main() {
    carregarEnv();
    const config = aplicarArgumentos(lerConfig(), process.argv.slice(2));
    const erros = validarConfig(config);

    if (erros.length > 0) {
        erros.forEach((erro) => console.error(`🔴 [COLETOR] ${erro}`));
        process.exit(1);
    }

    console.log(`🔵 [COLETOR] Simulador iniciado (perfil "${config.perfil}") → ${config.apiUrl}`);
    console.log(`🔵 [COLETOR] Lote a cada ${config.tamanhoLote} eventos ou ${config.intervaloEnvioMs / 1000}s. Nenhuma tecla ou texto é registrado.`);
    if (config.duracaoSeg) console.log(`🔵 [COLETOR] Encerramento automático em ${config.duracaoSeg}s.`);

    const coletor = criarColetor({ config });
    const simulador = iniciarSimulador(PERFIS[config.perfil], coletor.registrarEvento);
    const temporizador = setInterval(() => {
        if (coletor.chaveFoiRejeitada()) return encerrar(1);
        coletor.descarregar();
    }, config.intervaloEnvioMs);

    let encerrando = false;

    async function encerrar(codigo = 0) {
        if (encerrando) return;
        encerrando = true;

        simulador.parar();
        clearInterval(temporizador);

        // Última tentativa de enviar o que ficou na fila
        console.log('🔵 [COLETOR] Encerrando: enviando eventos pendentes...');
        while (coletor.tamanhoFila() > 0 && (await coletor.descarregar({ forcar: true })) === 'enviado');

        const { gerados, enviados, descartados, lotes, falhas } = coletor.estatisticas;
        console.log(`🔵 [COLETOR] Resumo: ${gerados} gerados, ${enviados} enviados em ${lotes} lotes, ` +
            `${descartados} descartados, ${falhas} falhas, ${coletor.tamanhoFila()} não enviados.`);
        process.exit(codigo);
    }

    process.on('SIGINT', () => encerrar(0));
    process.on('SIGTERM', () => encerrar(0));
    if (config.duracaoSeg) setTimeout(() => encerrar(0), config.duracaoSeg * 1000);
}

if (require.main === module) {
    main();
}

module.exports = {
    CAMPOS_PERMITIDOS,
    PERFIS,
    lerConfig,
    aplicarArgumentos,
    validarConfig,
    gerarMetricas,
    montarPacote,
    criarColetor
};
