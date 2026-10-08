function validarTelemetria(payload) {
    // 1. Regra de LGPD (Anti-Keylogging): Bloqueia se houver campos de texto literal
    const chavesProibidas = ['key', 'tecla', 'text', 'texto', 'conteudo'];
    const possuiKeylogging = Object.keys(payload).some(chave => chavesProibidas.includes(chave.toLowerCase()));

    if (possuiKeylogging) {
        console.error('🔴 [ALERTA DE SEGURANÇA] Pacote rejeitado: Violação de privacidade (Possível Keylogging).');
        return { sucesso: false, erro: 'Violação de LGPD' };
    }

    // 2. Validação de Estrutura Numérica (Metadados comportamentais)
    const { userId, timestamp, dwellTime, flightTime, mouseSpeed } = payload;

    if (!userId || typeof dwellTime !== 'number' || typeof flightTime !== 'number' || typeof mouseSpeed !== 'number') {
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

// --- TESTES DE VALIDAÇÃO ---
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