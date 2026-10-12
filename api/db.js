const { Pool } = require('pg');

// Mesmas variáveis usadas pelos scripts de IA em ai/ (ECOS_DB_NAME, ECOS_DB_PASSWORD)
const pool = new Pool({
    host: process.env.ECOS_DB_HOST || 'localhost',
    port: Number(process.env.ECOS_DB_PORT || 5432),
    database: process.env.ECOS_DB_NAME || 'ecos_teste',
    user: process.env.ECOS_DB_USER || 'postgres',
    password: process.env.ECOS_DB_PASSWORD
});

pool.on('error', (erro) => {
    console.error('🔴 [BANCO] Erro inesperado numa ligação inativa do pool:', erro.message);
});

module.exports = pool;
