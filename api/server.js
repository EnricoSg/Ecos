const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const { createApp } = require('./app');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);

if (!process.env.ECOS_DB_PASSWORD) {
    console.warn('🟡 [AVISO] ECOS_DB_PASSWORD não está definida. Copia api/.env.example para api/.env.');
}

const servidor = createApp(db).listen(PORT, () => {
    console.log(`🟢 API Ecos a correr em http://localhost:${PORT}`);
});

function encerrar() {
    servidor.close(() => db.end().then(() => process.exit(0)));
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
