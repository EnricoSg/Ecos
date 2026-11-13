const path = require('path');
const { carregarConfiguracao } = require('../config/carregar-env');

// Sistema > api/.env > .env da raiz > config/desenvolvimento.env (este último só fora de produção)
carregarConfiguracao({ envDoModulo: path.join(__dirname, '.env') });

const { createApp } = require('./app');
const { lerConfig, pendenciasDeConfig, impedeInicio } = require('./config');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const TEMPO_MAXIMO_ENCERRAMENTO_MS = 10 * 1000;
const config = lerConfig();
const senhaDoBanco = process.env.ECOS_DB_PASSWORD;

if (!senhaDoBanco) {
    console.warn('🟡 [AVISO] ECOS_DB_PASSWORD não está definida.');
}

for (const pendencia of pendenciasDeConfig(config)) {
    console.warn(`🟡 [AVISO] Variável de ambiente pendente: ${pendencia}`);
}

// Em produção, subir com segredo ausente ou fraco é pior do que não subir
if (impedeInicio(config, senhaDoBanco)) {
    console.error('🔴 [API] Configuração incompleta em produção. Corrija as pendências acima e reinicie.');
    process.exit(1);
}

const servidor = createApp(db, config).listen(PORT, () => {
    console.log(`🟢 API Ecos rodando em http://localhost:${PORT}`);
    if (config.docsHabilitadas) {
        console.log(`📘 Swagger disponível em http://localhost:${PORT}/api-docs`);
    }
});

let encerrando = false;

// Fecha o servidor e o pool do banco. `codigo` 0 = desligamento normal, 1 = falha (o gerenciador de processos reinicia).
function encerrar(codigo = 0) {
    if (encerrando) return;
    encerrando = true;

    // Se alguma conexão travar o encerramento, força a saída em vez de ficar pendurado
    setTimeout(() => process.exit(codigo || 1), TEMPO_MAXIMO_ENCERRAMENTO_MS).unref();

    servidor.close(() => {
        db.end().catch(() => {}).then(() => process.exit(codigo));
    });
    servidor.closeIdleConnections?.();
}

// Iniciada pelo scripts/iniciar.js (canal IPC): o orquestrador desliga o coletor primeiro e só depois a API,
// para o último lote do coletor ainda ser gravado. Por isso o Ctrl+C do terminal (que chega a todos os
// processos ao mesmo tempo) é ignorado aqui; se o orquestrador cair, o canal fecha e a API encerra.
if (process.send) {
    process.on('message', (mensagem) => {
        if (mensagem === 'encerrar') encerrar(0);
    });
    process.on('disconnect', () => encerrar(0));
    process.on('SIGINT', () => {});
} else {
    process.on('SIGINT', () => encerrar(0));
}

process.on('SIGTERM', () => encerrar(0));

// Erro não tratado deixa o processo em estado desconhecido: registra, encerra e sai com código 1
// para o gerenciador de processos (PM2, systemd, Docker, Render...) subir uma instância limpa.
// Só código/mensagem vão para o log, nunca o objeto inteiro, para não vazar dados de requisição.
function falhaCritica(tipo) {
    return (erro) => {
        console.error(`🔴 [API] ${tipo}:`, erro?.code || erro?.message || 'sem detalhes');
        encerrar(1);
    };
}

process.on('uncaughtException', falhaCritica('Exceção não tratada'));
process.on('unhandledRejection', falhaCritica('Promessa rejeitada sem tratamento'));
