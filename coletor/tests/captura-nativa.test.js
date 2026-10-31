const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    FLIGHT_MAXIMO_MS, DWELL_MAXIMO_MS, PAUSA_MOUSE_MS, criarCalculadora, iniciarCapturaNativa
} = require('../captura-nativa');
const { CAMPOS_PERMITIDOS, lerConfig, aplicarArgumentos, validarConfig, montarPacote } = require('../index');

const USER_ID = 'a2a0159acf6ac55f05c0c4d4bdc54004';
const TECLA_A = 30;
const TECLA_B = 48;

// Relógio controlado pelo teste: `avancar(ms)` move o tempo para frente
function criarRelogio() {
    let tempo = 1000;
    return { relogio: () => tempo, avancar: (ms) => { tempo += ms; } };
}

function criarCenario() {
    const eventos = [];
    const { relogio, avancar } = criarRelogio();
    const calculadora = criarCalculadora((metricas, timestamp) => eventos.push({ metricas, timestamp }), {
        relogio,
        agora: () => 1790723199823
    });

    // Digita uma tecla: espera `flight` desde o último keyup e segura por `dwell`
    function digitar(codigo, { flight = 100, dwell = 90 } = {}) {
        avancar(flight);
        calculadora.teclaPressionada(codigo);
        avancar(dwell);
        calculadora.teclaSolta(codigo);
    }

    return { calculadora, eventos, avancar, digitar };
}

// Hook falso com a mesma interface do uIOhook (EventEmitter + start/stop)
function criarHookFalso({ falharAoIniciar = false } = {}) {
    const hook = new EventEmitter();
    hook.iniciado = false;
    hook.start = () => {
        if (falharAoIniciar) throw new Error('sem permissão');
        hook.iniciado = true;
    };
    hook.stop = () => { hook.iniciado = false; };
    return hook;
}

function logSilencioso() {
    const mensagens = [];
    const registrar = (mensagem) => mensagens.push(mensagem);
    return { log: registrar, warn: registrar, error: registrar, mensagens };
}

describe('Captura real: dwell e flight time', () => {
    test('primeira tecla não gera evento (sem keyup anterior); a seguinte gera dwell e flight', () => {
        const { eventos, digitar } = criarCenario();

        digitar(TECLA_A);
        assert.equal(eventos.length, 0);

        digitar(TECLA_B, { flight: 120, dwell: 85 });
        assert.equal(eventos.length, 1);
        assert.deepEqual(eventos[0].metricas, { dwellTime: 85, flightTime: 120, mouseSpeed: 0 });
        assert.equal(eventos[0].timestamp, 1790723199823);
    });

    test(`pausa maior que ${FLIGHT_MAXIMO_MS}ms descarta o flight time e não gera evento`, () => {
        const { eventos, digitar } = criarCenario();

        digitar(TECLA_A);
        digitar(TECLA_B, { flight: FLIGHT_MAXIMO_MS + 1 });
        assert.equal(eventos.length, 0);

        // A digitação contínua volta a gerar eventos logo depois
        digitar(TECLA_A, { flight: FLIGHT_MAXIMO_MS });
        assert.equal(eventos.length, 1);
        assert.equal(eventos[0].metricas.flightTime, FLIGHT_MAXIMO_MS);
    });

    test('keydown repetido (tecla segurada) mede o dwell desde o primeiro keydown', () => {
        const { calculadora, eventos, avancar, digitar } = criarCenario();
        digitar(TECLA_A);

        avancar(50);
        calculadora.teclaPressionada(TECLA_B);
        avancar(40);
        calculadora.teclaPressionada(TECLA_B);
        avancar(40);
        calculadora.teclaSolta(TECLA_B);

        assert.deepEqual(eventos.map((e) => e.metricas.dwellTime), [80]);
        assert.equal(calculadora.teclasPressionadas(), 0, 'a tecla sai do Map no keyup');
    });

    test(`tecla segurada por mais de ${DWELL_MAXIMO_MS}ms é descartada`, () => {
        const { eventos, digitar } = criarCenario();
        digitar(TECLA_A);
        digitar(TECLA_B, { dwell: DWELL_MAXIMO_MS + 1 });

        assert.equal(eventos.length, 0);
    });

    test('keyup sem keydown correspondente é ignorado', () => {
        const { calculadora, eventos } = criarCenario();
        calculadora.teclaSolta(TECLA_A);

        assert.equal(eventos.length, 0);
        assert.equal(calculadora.teclasPressionadas(), 0);
    });
});

describe('Captura real: velocidade do mouse', () => {
    test('distância euclidiana dividida pelo tempo, em px/s, e zera após cada evento', () => {
        const { calculadora, eventos, avancar, digitar } = criarCenario();
        digitar(TECLA_A);

        calculadora.mouseMoveu(0, 0);
        avancar(10);
        calculadora.mouseMoveu(3, 4); // 5 px em 10 ms
        avancar(10);
        calculadora.mouseMoveu(6, 8); // +5 px em 10 ms → 10 px / 20 ms = 500 px/s

        digitar(TECLA_B);
        digitar(TECLA_A);

        assert.deepEqual(eventos.map((e) => e.metricas.mouseSpeed), [500, 0]);
    });

    test(`mouse parado por mais de ${PAUSA_MOUSE_MS}ms não reduz a velocidade`, () => {
        const { calculadora, eventos, avancar, digitar } = criarCenario();
        digitar(TECLA_A);

        calculadora.mouseMoveu(0, 0);
        avancar(10);
        calculadora.mouseMoveu(10, 0); // 10 px em 10 ms = 1000 px/s
        avancar(PAUSA_MOUSE_MS + 1);
        calculadora.mouseMoveu(10, 500); // salto após a pausa: não conta
        avancar(10);
        calculadora.mouseMoveu(20, 500); // 10 px em 10 ms

        digitar(TECLA_B);
        assert.equal(eventos[0].metricas.mouseSpeed, 1000);
    });
});

describe('Captura real: LGPD por design', () => {
    test('o evento contém só os três números, nunca o código da tecla', () => {
        const { eventos, digitar } = criarCenario();
        digitar(TECLA_A);
        digitar(TECLA_B);

        const { metricas } = eventos[0];
        assert.deepEqual(Object.keys(metricas).sort(), ['dwellTime', 'flightTime', 'mouseSpeed']);
        assert.ok(!Object.values(metricas).includes(TECLA_B));

        const pacote = montarPacote(USER_ID, metricas, eventos[0].timestamp);
        assert.deepEqual(Object.keys(pacote), CAMPOS_PERMITIDOS);
    });

    test('eventos reais do hook chegam ao coletor sem keycode nem coordenadas', () => {
        const hook = criarHookFalso();
        const recebidos = [];
        const { relogio, avancar } = criarRelogio();
        iniciarCapturaNativa((metricas) => recebidos.push(metricas), { carregarHook: () => hook, relogio });

        const tecla = (keycode) => ({ keycode, time: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
        hook.emit('keydown', tecla(TECLA_A));
        avancar(90);
        hook.emit('keyup', tecla(TECLA_A));
        avancar(100);
        hook.emit('mousemove', { x: 100, y: 200 });
        hook.emit('keydown', tecla(TECLA_B));
        avancar(80);
        hook.emit('keyup', tecla(TECLA_B));

        assert.deepEqual(recebidos, [{ dwellTime: 80, flightTime: 100, mouseSpeed: 0 }]);
        assert.ok(!JSON.stringify(recebidos).includes('keycode'));
    });
});

describe('Captura real: ciclo de vida do hook', () => {
    test('inicia o hook e, ao parar, desliga e remove os ouvintes', () => {
        const hook = criarHookFalso();
        const captura = iniciarCapturaNativa(() => {}, { carregarHook: () => hook });

        assert.equal(hook.iniciado, true);
        assert.equal(hook.listenerCount('keydown'), 1);

        captura.parar();
        captura.parar();
        assert.equal(hook.iniciado, false);
        assert.equal(hook.listenerCount('keydown') + hook.listenerCount('keyup') + hook.listenerCount('mousemove'), 0);
    });

    test('falha ao iniciar o hook vira erro amigável e não deixa ouvintes', () => {
        const hook = criarHookFalso({ falharAoIniciar: true });

        assert.throws(() => iniciarCapturaNativa(() => {}, { carregarHook: () => hook }), /Falha ao iniciar a captura.*sem permissão/);
        assert.equal(hook.listenerCount('keydown'), 0);
    });

    test('módulo nativo ausente vira erro amigável', () => {
        const carregarHook = () => {
            throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
        };

        assert.throws(() => iniciarCapturaNativa(() => {}, { carregarHook }), /uiohook-napi \(MODULE_NOT_FOUND\).*npm install/);
    });

    test('erro no processamento de um evento é registrado sem derrubar o hook e sem dados do evento', () => {
        const hook = criarHookFalso();
        const log = logSilencioso();
        const { relogio, avancar } = criarRelogio();
        iniciarCapturaNativa(() => { throw new Error('falha no coletor'); }, { carregarHook: () => hook, log, relogio });

        for (const keycode of [TECLA_A, TECLA_B]) {
            avancar(100);
            hook.emit('keydown', { keycode });
            avancar(80);
            hook.emit('keyup', { keycode });
        }

        assert.equal(log.mensagens.length, 1);
        assert.match(log.mensagens[0], /falha no coletor/);
        assert.ok(!log.mensagens[0].includes(String(TECLA_B)));
    });
});

describe('Configuração do modo', () => {
    test('padrão é simulado; --modo=real e MODO trocam a fonte', () => {
        assert.equal(lerConfig({}).modo, 'simulado');
        assert.equal(lerConfig({ MODO: 'real' }).modo, 'real');
        assert.equal(aplicarArgumentos(lerConfig({}), ['--modo=real']).modo, 'real');
    });

    test('modo desconhecido é apontado como configuração inválida', () => {
        const config = { ...lerConfig({ API_KEY: 'chave', USER_ID }), modo: 'teclado' };
        assert.deepEqual(validarConfig(config), ['MODO deve ser um destes: simulado, real.']);
    });
});
