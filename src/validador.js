// Lista branca: únicos campos aceites num pacote de telemetria (minimização de dados - LGPD art. 6º, III).
// Qualquer outro campo é tratado como tentativa de envio de dados não autorizados (ex.: keylogging).
const CAMPOS_PERMITIDOS = ['userId', 'timestamp', 'dwellTime', 'flightTime', 'mouseSpeed'];

// O userId tem de ser um hash anónimo em hexadecimal (128 a 256 bits), nunca texto livre.
const FORMATO_USER_ID = /^[a-f0-9]{32,64}$/i;

function ehMetricaValida(valor) {
    return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

function validarTelemetria(payload) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        console.error('🟡 [ERRO] Pacote inválido: o payload tem de ser um objeto.');
        return { sucesso: false, erro: 'Estrutura inválida' };
    }

    // 1. Regra de LGPD (Anti-Keylogging): Bloqueia qualquer campo fora da lista branca
    const camposNaoAutorizados = Object.keys(payload).filter(chave => !CAMPOS_PERMITIDOS.includes(chave));

    if (camposNaoAutorizados.length > 0) {
        console.error('🔴 [ALERTA DE SEGURANÇA] Pacote rejeitado: Violação de privacidade (Possível Keylogging).');
        return { sucesso: false, erro: 'Violação de LGPD' };
    }

    const { userId, timestamp, dwellTime, flightTime, mouseSpeed } = payload;

    // O identificador também não pode transportar texto literal
    if (typeof userId !== 'string' || !FORMATO_USER_ID.test(userId)) {
        console.error('🔴 [ALERTA DE SEGURANÇA] Pacote rejeitado: userId não é um hash anónimo.');
        return { sucesso: false, erro: 'Violação de LGPD' };
    }

    // 2. Validação de Estrutura Numérica (Metadados comportamentais)
    if (!Number.isInteger(timestamp) || timestamp <= 0 ||
        !ehMetricaValida(dwellTime) || !ehMetricaValida(flightTime) || !ehMetricaValida(mouseSpeed)) {
        console.error('🟡 [ERRO] Pacote inválido: Metadados numéricos ausentes ou corrompidos.');
        return { sucesso: false, erro: 'Estrutura inválida' };
    }

    // 3. Formatação final (O payload que será enviado para o PostgreSQL)
    const dadosLimpos = {
        id_usuario: userId,
        data_evento: new Date(timestamp).toISOString(),
        tempo_pressao_ms: dwellTime,
        tempo_voo_ms: flightTime,
        velocidade_rato_px: mouseSpeed
    };

    console.log('🟢 [SUCESSO] Pacote validado e formatado para a base de dados.');
    return { sucesso: true, dados: dadosLimpos };
}

module.exports = { validarTelemetria, CAMPOS_PERMITIDOS };

// --- DEMONSTRAÇÃO (apenas com `node src/validador.js`; os testes oficiais estão em tests/) ---
if (require.main === module) {
    const pacoteValido = {
        userId: "4f9b8c7d6e5a4b3c2d1e0f9a8b7c6d5e",
        timestamp: 1705432000000,
        dwellTime: 85,
        flightTime: 120,
        mouseSpeed: 350
    };
    console.log("Teste 1:", validarTelemetria(pacoteValido));

    const pacoteInvasivo = {
        userId: "4f9b8c7d6e5a4b3c2d1e0f9a8b7c6d5e",
        timestamp: 1705432001000,
        tecla: "A",
        dwellTime: 90,
        flightTime: 110,
        mouseSpeed: 300
    };
    console.log("\nTeste 2:", validarTelemetria(pacoteInvasivo));
}
