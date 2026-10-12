// Centraliza a leitura das variáveis de ambiente. O createApp recebe este objeto,
// o que permite aos testes injetarem uma configuração própria sem mexer no process.env.
function lerNumero(valor, padrao) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

function lerConfig(env = process.env) {
    return {
        corsOrigem: env.CORS_ORIGIN || 'http://localhost:5173',

        // Chave do coletor oficial (cabeçalho X-API-Key). Sem ela, a entrada de telemetria fica bloqueada.
        apiKey: env.API_KEY || '',

        // Login do RH (provisório até existir uma tabela de usuários do RH)
        rhUsuario: env.RH_USUARIO || '',
        rhSenha: env.RH_SENHA || '',
        jwtSegredo: env.JWT_SECRET || '',
        jwtExpiraEm: env.JWT_EXPIRA_EM || '8h',

        // Envio em lote: máximo de pacotes por requisição
        loteMaximo: lerNumero(env.LOTE_MAXIMO, 1000),

        // Rate limit (janelas em minutos)
        limites: {
            loginMaximo: lerNumero(env.LIMITE_LOGIN, 10),
            loginJanelaMin: lerNumero(env.LIMITE_LOGIN_JANELA_MIN, 15),
            telemetriaMaximo: lerNumero(env.LIMITE_TELEMETRIA, 120),
            telemetriaJanelaMin: lerNumero(env.LIMITE_TELEMETRIA_JANELA_MIN, 1),
            leituraMaximo: lerNumero(env.LIMITE_LEITURA, 300),
            leituraJanelaMin: lerNumero(env.LIMITE_LEITURA_JANELA_MIN, 15)
        }
    };
}

// Lista o que falta configurar, para o server.js avisar na inicialização
function pendenciasDeConfig(config) {
    const pendencias = [];

    if (!config.apiKey) pendencias.push('API_KEY (POST /api/telemetria ficará bloqueada)');
    if (!config.rhUsuario || !config.rhSenha) pendencias.push('RH_USUARIO / RH_SENHA (login do RH desativado)');
    if (!config.jwtSegredo) pendencias.push('JWT_SECRET (login do RH desativado)');
    else if (config.jwtSegredo.length < 32) pendencias.push('JWT_SECRET deve ter pelo menos 32 caracteres');

    return pendencias;
}

module.exports = { lerConfig, pendenciasDeConfig };
