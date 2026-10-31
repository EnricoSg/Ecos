const { Pool } = require('pg');

function lerNumero(valor, padrao) {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

// O fuso entra direto na opção "-c timezone=..." da conexão, então só aceita nomes de fuso (ex.: America/Sao_Paulo).
// Sem ECOS_DB_TIMEZONE nada muda: a sessão usa o fuso padrão do servidor PostgreSQL.
const FUSO_VALIDO = /^[A-Za-z0-9_+\-/]+$/;
const fuso = FUSO_VALIDO.test(process.env.ECOS_DB_TIMEZONE || '') ? process.env.ECOS_DB_TIMEZONE : null;

// Bancos gerenciados (RDS, Supabase, Neon...) exigem TLS
const usarSsl = ['true', '1', 'require'].includes((process.env.ECOS_DB_SSL || '').toLowerCase());

// Mesmas variáveis usadas pelos scripts de IA em ai/ (ECOS_DB_NAME, ECOS_DB_PASSWORD)
const pool = new Pool({
    host: process.env.ECOS_DB_HOST || 'localhost',
    port: Number(process.env.ECOS_DB_PORT || 5432),
    database: process.env.ECOS_DB_NAME || 'ecos_teste',
    user: process.env.ECOS_DB_USER || 'postgres',
    password: process.env.ECOS_DB_PASSWORD,

    max: lerNumero(process.env.ECOS_DB_POOL_MAX, 10),
    idleTimeoutMillis: 30 * 1000,
    // Falha rápido se o banco estiver fora do ar, em vez de pendurar a requisição
    connectionTimeoutMillis: lerNumero(process.env.ECOS_DB_CONNECT_TIMEOUT_MS, 5000),
    // Uma consulta analítica presa não pode ocupar uma conexão do pool para sempre
    statement_timeout: lerNumero(process.env.ECOS_DB_STATEMENT_TIMEOUT_MS, 15000),

    ...(fuso && { options: `-c timezone=${fuso}` }),
    ...(usarSsl && { ssl: { rejectUnauthorized: process.env.ECOS_DB_SSL_REJECT_UNAUTHORIZED !== 'false' } })
});

pool.on('error', (erro) => {
    console.error('🔴 [BANCO] Erro inesperado em uma conexão inativa do pool:', erro.message);
});

module.exports = pool;
