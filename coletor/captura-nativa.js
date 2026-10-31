// =====================================================
// ECOS - Captura nativa (teclado e mouse reais)
//
// Escuta os eventos globais do sistema operacional com o uiohook-napi e os
// transforma nas mesmas métricas do simulador: dwellTime, flightTime e mouseSpeed.
//
// LGPD por design: o código da tecla só existe dentro deste arquivo, como chave
// de um Map em memória para casar o keydown com o keyup da mesma tecla. Ele é
// apagado no keyup e NUNCA entra no evento, na fila, no lote ou no log. Da posição
// do cursor guardamos apenas o último ponto, para medir a distância percorrida.
// =====================================================

// Intervalo maior que isso entre um keyup e o próximo keydown é pausa, não digitação contínua
const FLIGHT_MAXIMO_MS = 3000;

// Tecla segurada por mais tempo que isso (atalho, repetição, jogo) não representa digitação
const DWELL_MAXIMO_MS = 2000;

// Intervalo maior que isso entre dois movimentos do mouse começa um novo movimento:
// o tempo parado não entra no cálculo da velocidade
const PAUSA_MOUSE_MS = 200;

// -----------------------------------------------------
// Cálculo das métricas (sem dependência nativa, para poder ser testado)
// -----------------------------------------------------

// `relogio` é monotônico (não volta no tempo se o relógio do sistema for ajustado) e serve para medir durações.
// `agora` é o horário de parede usado no timestamp do pacote.
function criarCalculadora(aoGerarEvento, { relogio = () => performance.now(), agora = Date.now } = {}) {
    // código da tecla -> { inicio, flightTime } enquanto ela estiver pressionada
    const pressionadas = new Map();
    let ultimoKeyup = null;

    let ultimoPonto = null;
    let distancia = 0;
    let tempoMovimento = 0;

    // Velocidade média do mouse (px/s) desde o último evento gerado. Zera os acumuladores.
    function consumirVelocidadeMouse() {
        const velocidade = tempoMovimento > 0 ? (distancia / tempoMovimento) * 1000 : 0;
        distancia = 0;
        tempoMovimento = 0;
        return Math.round(velocidade);
    }

    function teclaPressionada(codigo) {
        // Tecla segurada gera keydown repetido sem keyup: vale só o primeiro
        if (pressionadas.has(codigo)) return;

        const tempo = relogio();
        const intervalo = ultimoKeyup === null ? null : tempo - ultimoKeyup;
        const flightTime = intervalo !== null && intervalo >= 0 && intervalo <= FLIGHT_MAXIMO_MS ? intervalo : null;

        pressionadas.set(codigo, { inicio: tempo, flightTime });
    }

    function teclaSolta(codigo) {
        const tempo = relogio();
        const registro = pressionadas.get(codigo);

        ultimoKeyup = tempo;
        pressionadas.delete(codigo);

        // keyup sem keydown (ex.: tecla já pressionada quando o coletor iniciou)
        if (!registro) return;

        const dwellTime = tempo - registro.inicio;

        // Primeira tecla após uma pausa não tem flightTime válido: não gera evento
        if (registro.flightTime === null || dwellTime > DWELL_MAXIMO_MS) return;

        // A API exige inteiros (as colunas do banco são INTEGER). Só os três números saem daqui.
        aoGerarEvento({
            dwellTime: Math.round(dwellTime),
            flightTime: Math.round(registro.flightTime),
            mouseSpeed: consumirVelocidadeMouse()
        }, agora());
    }

    function mouseMoveu(x, y) {
        const tempo = relogio();

        if (ultimoPonto) {
            const intervalo = tempo - ultimoPonto.tempo;
            if (intervalo >= 0 && intervalo <= PAUSA_MOUSE_MS) {
                distancia += Math.hypot(x - ultimoPonto.x, y - ultimoPonto.y);
                tempoMovimento += intervalo;
            }
        }

        ultimoPonto = { x, y, tempo };
    }

    return {
        teclaPressionada,
        teclaSolta,
        mouseMoveu,
        teclasPressionadas: () => pressionadas.size
    };
}

// -----------------------------------------------------
// Ligação com o sistema operacional
// -----------------------------------------------------

// O uiohook-napi é carregado só aqui, para o simulador e os testes não dependerem do módulo nativo
function carregarUiohook() {
    return require('uiohook-napi').uIOhook;
}

// Mesmo contrato do iniciarSimulador: chama `aoGerarEvento(metricas, timestamp)` e devolve { parar() }.
// Lança erro com mensagem amigável se o hook não puder ser carregado ou iniciado.
function iniciarCapturaNativa(aoGerarEvento, { carregarHook = carregarUiohook, log = console, ...opcoes } = {}) {
    let hook;
    try {
        hook = carregarHook();
    } catch (erro) {
        throw new Error(`Não foi possível carregar o uiohook-napi (${erro.code || erro.message}). Rode "npm install" em coletor/.`);
    }

    const calculadora = criarCalculadora(aoGerarEvento, opcoes);

    // Um erro aqui não pode derrubar o hook do sistema. O log nunca inclui o evento (teria o código da tecla).
    function protegido(tratar) {
        return (evento) => {
            try {
                tratar(evento);
            } catch (erro) {
                log.error(`🔴 [COLETOR] Erro ao processar evento de entrada: ${erro.message}`);
            }
        };
    }

    const ouvintes = {
        keydown: protegido((evento) => calculadora.teclaPressionada(evento.keycode)),
        keyup: protegido((evento) => calculadora.teclaSolta(evento.keycode)),
        mousemove: protegido((evento) => calculadora.mouseMoveu(evento.x, evento.y))
    };

    function removerOuvintes() {
        for (const [nome, ouvinte] of Object.entries(ouvintes)) {
            hook.removeListener(nome, ouvinte);
        }
    }

    for (const [nome, ouvinte] of Object.entries(ouvintes)) {
        hook.on(nome, ouvinte);
    }

    try {
        hook.start();
    } catch (erro) {
        removerOuvintes();
        throw new Error(`Falha ao iniciar a captura do sistema operacional (${erro.message}). ` +
            'No macOS, conceda permissão de Acessibilidade ao terminal; no Linux, é preciso uma sessão X11.');
    }

    let ativo = true;

    return {
        parar() {
            if (!ativo) return;
            ativo = false;
            removerOuvintes();
            hook.stop();
        }
    };
}

module.exports = {
    FLIGHT_MAXIMO_MS,
    DWELL_MAXIMO_MS,
    PAUSA_MOUSE_MS,
    criarCalculadora,
    iniciarCapturaNativa
};
