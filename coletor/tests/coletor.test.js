const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    CAMPOS_PERMITIDOS, PERFIS, lerConfig, aplicarArgumentos, validarConfig, gerarMetricas, montarPacote, criarColetor
} = require('../index');

const USER_ID = 'a2a0159acf6ac55f05c0c4d4bdc54004';

function configTeste(extra = {}) {
    return { ...lerConfig({ API_KEY: 'chave', USER_ID }), ...extra };
}

function logSilencioso() {
    const mensagens = [];
    const registrar = (mensagem) => mensagens.push(mensagem);
    return { log: registrar, warn: registrar, error: registrar, mensagens };
}

// fetch simulado: devolve as respostas na ordem e guarda cada requisição
function criarEnvioFalso(...respostas) {
    const chamadas = [];
    const enviar = async (url, opcoes) => {
        chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body) });
        const resposta = respostas.length > 1 ? respostas.shift() : respostas[0];
        if (resposta instanceof Error) throw resposta;
        return { status: resposta.status, json: async () => resposta.corpo || {} };
    };
    return { enviar, chamadas };
}

function media(valores) {
    return valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
}

describe('Simulador de métricas', () => {
    test('gera apenas inteiros não negativos dentro dos limites do perfil', () => {
        for (const perfil of Object.values(PERFIS)) {
            for (let i = 0; i < 5000; i++) {
                const { dwellTime, flightTime, mouseSpeed } = gerarMetricas(perfil);

                assert.ok(Number.isInteger(dwellTime) && Number.isInteger(flightTime) && Number.isInteger(mouseSpeed));
                assert.ok(dwellTime >= perfil.dwell.minimo && dwellTime <= perfil.dwell.maximo);
                assert.ok(flightTime >= perfil.flight.minimo && flightTime <= perfil.flight.maximo + perfil.pausa.maximo);
                assert.ok(mouseSpeed >= perfil.mouse.minimo && mouseSpeed <= perfil.mouse.maximo);
            }
        }
    });

    test('valores coerentes com digitação humana e perfil de fadiga mais lento', () => {
        const amostra = (perfil) => Array.from({ length: 5000 }, () => gerarMetricas(perfil));
        const normal = amostra(PERFIS.normal);
        const fadiga = amostra(PERFIS.fadiga);

        const dwellNormal = media(normal.map((m) => m.dwellTime));
        assert.ok(dwellNormal > 80 && dwellNormal < 120, `dwell médio ${dwellNormal}`);

        assert.ok(media(fadiga.map((m) => m.dwellTime)) > dwellNormal);
        assert.ok(media(fadiga.map((m) => m.flightTime)) > media(normal.map((m) => m.flightTime)));
        assert.ok(media(fadiga.map((m) => m.mouseSpeed)) < media(normal.map((m) => m.mouseSpeed)));
    });
});

describe('LGPD por design', () => {
    test('o pacote contém exatamente os campos da lista branca', () => {
        const pacote = montarPacote(USER_ID, { dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1790723199823);

        assert.deepEqual(Object.keys(pacote), CAMPOS_PERMITIDOS);
        assert.deepEqual(pacote, { userId: USER_ID, timestamp: 1790723199823, dwellTime: 90, flightTime: 80, mouseSpeed: 400 });
    });

    test('campos extras nas métricas (ex.: tecla) nunca saem da máquina', () => {
        const pacote = montarPacote(USER_ID, { dwellTime: 90, flightTime: 80, mouseSpeed: 400, tecla: 'A', texto: 'senha' }, 1);

        assert.equal('tecla' in pacote, false);
        assert.equal('texto' in pacote, false);
    });

    test('as métricas geradas não têm nenhum campo além dos três números', () => {
        assert.deepEqual(Object.keys(gerarMetricas(PERFIS.normal)).sort(), ['dwellTime', 'flightTime', 'mouseSpeed']);
    });
});

describe('Envio em lote', () => {
    test('dispara ao atingir o tamanho do lote, com X-API-Key e um array no corpo', async () => {
        const { enviar, chamadas } = criarEnvioFalso({ status: 201, corpo: { ids: [1, 2, 3] } });
        const coletor = criarColetor({ config: configTeste({ tamanhoLote: 3 }), enviar, log: logSilencioso() });

        coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);
        coletor.registrarEvento({ dwellTime: 91, flightTime: 81, mouseSpeed: 401 }, 2);
        assert.equal(chamadas.length, 0, 'não envia evento a evento');

        coletor.registrarEvento({ dwellTime: 92, flightTime: 82, mouseSpeed: 402 }, 3);
        await new Promise(setImmediate);

        assert.equal(chamadas.length, 1);
        assert.equal(chamadas[0].url, 'http://localhost:3000/api/telemetria');
        assert.equal(chamadas[0].opcoes.method, 'POST');
        assert.equal(chamadas[0].opcoes.headers['X-API-Key'], 'chave');
        assert.equal(chamadas[0].corpo.length, 3);
        assert.deepEqual(chamadas[0].corpo.map((p) => p.timestamp), [1, 2, 3]);
        assert.equal(coletor.tamanhoFila(), 0);
        assert.equal(coletor.estatisticas.enviados, 3);
    });

    test('descarregar envia o que houver na fila (disparo por tempo)', async () => {
        const { enviar, chamadas } = criarEnvioFalso({ status: 201, corpo: { ids: [1] } });
        const coletor = criarColetor({ config: configTeste(), enviar, log: logSilencioso() });

        coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);
        assert.equal(await coletor.descarregar(), 'enviado');
        assert.equal(chamadas[0].corpo.length, 1);
        assert.equal(await coletor.descarregar(), 'ignorado', 'fila vazia não gera requisição');
    });

    test('API fora do ar: o lote volta para a fila e espera antes de tentar de novo', async () => {
        let relogio = 0;
        const { enviar, chamadas } = criarEnvioFalso(new TypeError('fetch failed'), { status: 201, corpo: { ids: [1, 2] } });
        const coletor = criarColetor({ config: configTeste(), enviar, log: logSilencioso(), agora: () => relogio });

        coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);
        coletor.registrarEvento({ dwellTime: 91, flightTime: 81, mouseSpeed: 401 }, 2);

        assert.equal(await coletor.descarregar(), 'reenfileirado');
        assert.equal(coletor.tamanhoFila(), 2);
        assert.equal(await coletor.descarregar(), 'aguardando');

        relogio = 5000;
        assert.equal(await coletor.descarregar(), 'enviado');
        assert.deepEqual(chamadas[1].corpo.map((p) => p.timestamp), [1, 2], 'mantém a ordem original');
    });

    for (const status of [429, 500, 503]) {
        test(`${status}: lote volta para a fila`, async () => {
            const { enviar } = criarEnvioFalso({ status, corpo: { erro: 'x' } });
            const coletor = criarColetor({ config: configTeste(), enviar, log: logSilencioso() });

            coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);

            assert.equal(await coletor.descarregar(), 'reenfileirado');
            assert.equal(coletor.tamanhoFila(), 1);
        });
    }

    test('400: lote rejeitado é descartado para não travar a fila', async () => {
        const { enviar } = criarEnvioFalso({ status: 400, corpo: { erro: 'Violação de LGPD', indice: 0 } });
        const log = logSilencioso();
        const coletor = criarColetor({ config: configTeste(), enviar, log });

        coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);

        assert.equal(await coletor.descarregar(), 'descartado');
        assert.equal(coletor.tamanhoFila(), 0);
        assert.equal(coletor.estatisticas.descartados, 1);
        assert.match(log.mensagens.at(-1), /Violação de LGPD/);
    });

    test('401: para de enviar e preserva os eventos', async () => {
        const { enviar, chamadas } = criarEnvioFalso({ status: 401, corpo: { erro: 'Chave de API inválida ou ausente' } });
        const coletor = criarColetor({ config: configTeste(), enviar, log: logSilencioso() });

        coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, 1);

        assert.equal(await coletor.descarregar(), 'chave_rejeitada');
        assert.equal(coletor.chaveFoiRejeitada(), true);
        assert.equal(await coletor.descarregar(), 'ignorado');
        assert.equal(chamadas.length, 1);
        assert.equal(coletor.tamanhoFila(), 1);
    });

    test('fila cheia descarta os eventos mais antigos', () => {
        const { enviar } = criarEnvioFalso({ status: 201 });
        const coletor = criarColetor({ config: configTeste({ filaMaxima: 3, tamanhoLote: 100 }), enviar, log: logSilencioso() });

        for (let i = 1; i <= 5; i++) coletor.registrarEvento({ dwellTime: 90, flightTime: 80, mouseSpeed: 400 }, i);

        assert.equal(coletor.tamanhoFila(), 3);
        assert.equal(coletor.estatisticas.descartados, 2);
    });
});

describe('Configuração', () => {
    test('valores padrão do lote: 20 eventos ou 5 segundos', () => {
        const config = lerConfig({});

        assert.equal(config.tamanhoLote, 20);
        assert.equal(config.intervaloEnvioMs, 5000);
        assert.equal(config.apiUrl, 'http://localhost:3000/api/telemetria');
    });

    test('argumentos sobrescrevem o .env', () => {
        const config = aplicarArgumentos(lerConfig({}), ['--perfil=fadiga', '--duracao=15']);

        assert.equal(config.perfil, 'fadiga');
        assert.equal(config.duracaoSeg, 15);
    });

    test('aponta configuração inválida', () => {
        assert.deepEqual(validarConfig(configTeste()), []);
        assert.equal(validarConfig(lerConfig({})).length, 2, 'sem API_KEY e sem USER_ID');
        assert.equal(validarConfig(configTeste({ userId: 'joao@empresa.com' })).length, 1);
        assert.equal(validarConfig(configTeste({ perfil: 'toString' })).length, 1);
        assert.equal(validarConfig(configTeste({ apiUrl: 'nao é url' })).length, 1);
    });
});
