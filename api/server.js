const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { createApp } = require('./app');
const { lerConfig, pendenciasDeConfig } = require('./config');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const config = lerConfig();

if (!process.env.ECOS_DB_PASSWORD) {
    console.warn('🟡 [AVISO] ECOS_DB_PASSWORD não está definida. Copie api/.env.example para api/.env.');
}

for (const pendencia of pendenciasDeConfig(config)) {
    console.warn(`🟡 [AVISO] Configure no api/.env: ${pendencia}`);
}

const servidor = createApp(db, config).listen(PORT, () => {
    console.log(`🟢 API Ecos rodando em http://localhost:${PORT}`);
    console.log(`📘 Swagger disponível em http://localhost:${PORT}/api-docs`);
});

function encerrar() {
    servidor.close(() => db.end().then(() => process.exit(0)));
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
