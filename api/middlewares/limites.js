const { rateLimit } = require('express-rate-limit');

const MINUTO_MS = 60 * 1000;

function criarLimite(maximo, janelaMin, opcoes = {}) {
    return rateLimit({
        windowMs: janelaMin * MINUTO_MS,
        limit: maximo,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { erro: 'Muitas requisições. Tente novamente mais tarde.' },
        ...opcoes
    });
}

// Cada createApp cria os seus próprios contadores (em memória, por IP).
// Com mais de uma instância da API, será preciso um store compartilhado (ex.: Redis).
function criarLimites({ limites }) {
    return {
        // Login: janela longa e só conta tentativas falhas, para frear ataques de força bruta
        login: criarLimite(limites.loginMaximo, limites.loginJanelaMin, { skipSuccessfulRequests: true }),
        telemetria: criarLimite(limites.telemetriaMaximo, limites.telemetriaJanelaMin),
        leitura: criarLimite(limites.leituraMaximo, limites.leituraJanelaMin)
    };
}

module.exports = { criarLimites };
