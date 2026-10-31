// Centraliza a leitura das variáveis de ambiente. O createApp recebe este objeto,
// o que permite aos testes injetarem uma configuração própria sem mexer no process.env.
function lerNumero(valor, padrao) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

// Quantos proxies reversos (Nginx, Render, Heroku...) ficam na frente da API.
// Sem isso, o rate limit enxerga o IP do proxy e bloqueia todos os usuários juntos.
// Aceita um número de saltos (ex.: 1), "loopback" ou uma sub-rede. Vazio/false = sem proxy.
function lerTrustProxy(valor) {
    if (valor === undefined || valor === '' || valor === 'false') return false;
    if (valor === 'true') return 1;
    if (/^\d+$/.test(valor)) return Number(valor);
    return valor;
}

function lerConfig(env = process.env) {
    return {
        ambiente: env.NODE_ENV || 'development',
        corsOrigem: env.CORS_ORIGIN || 'http://localhost:5173',
        trustProxy: lerTrustProxy(env.TRUST_PROXY),

        // Swagger UI em /api-docs. Em produção, defina DOCS_HABILITADAS=false se não quiser expô-lo.
        docsHabilitadas: env.DOCS_HABILITADAS !== 'false',

        // Chave do coletor oficial (cabeçalho X-API-Key). Sem ela, a entrada de telemetria fica bloqueada.
        apiKey: env.API_KEY || '',

        // Login do RH (provisório até existir uma tabela de usuários do RH)
        rhUsuario: env.RH_USUARIO || '',
        rhSenha: env.RH_SENHA || '',
        jwtSegredo: env.JWT_SECRET || '',
        jwtExpiraEm: env.JWT_EXPIRA_EM || '8h',

        // Privacidade: dados agregados de um setor só são exibidos com pelo menos N colaboradores ativos.
        // 1 = desligado. Recomendado em produção: 5.
        minColaboradoresSetor: lerNumero(env.MIN_COLABORADORES_SETOR, 1),

        // Tamanho da janela de análise da IA, em minutos. Usa a MESMA variável do ai/.env:
        // o detalhe do alerta reconstrói a janela que gerou a anomalia com este valor.
        janelaAnaliseMin: lerNumero(env.IA_JANELA_MINUTOS, 15),

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

// Em produção, subir com segredo ausente ou fraco é pior do que não subir.
// Em desenvolvimento as pendências viram apenas avisos.
function impedeInicio(config, senhaDoBanco) {
    return config.ambiente === 'production' && (pendenciasDeConfig(config).length > 0 || !senhaDoBanco);
}

module.exports = { lerConfig, pendenciasDeConfig, impedeInicio };
