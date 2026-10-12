const express = require('express');
const cors = require('cors');
const { validarTelemetria } = require('../src/validador');

// Insere a telemetria e resolve o colaborador pelo hash anónimo numa única query.
// Se o hash não existir (ou o colaborador estiver inativo), nenhuma linha é inserida.
const SQL_INSERIR_TELEMETRIA = `
    INSERT INTO telemetria (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
    SELECT c.id, $2, $3, $4, $5
    FROM colaborador c
    WHERE c.codigo_anonimo = $1
      AND c.ativo
    RETURNING id, data_coleta;
`;

// Converte a saída do validador nos parâmetros da tabela telemetria.
// As colunas dwell_time, flight_time e mouse_speed são INTEGER: valores decimais são rejeitados
// em vez de arredondados em silêncio pelo PostgreSQL.
function paraParametrosTelemetria(dados) {
    const metricas = [dados.tempo_pressao_ms, dados.tempo_voo_ms, dados.velocidade_rato_px];

    if (!metricas.every(Number.isInteger)) {
        return null;
    }

    return [dados.id_usuario, ...metricas, dados.data_evento];
}

function createApp(db) {
    const app = express();

    app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
    app.use(express.json({ limit: '10kb' }));

    app.get('/api/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', banco: 'ligado' });
        } catch {
            res.status(503).json({ status: 'erro', banco: 'indisponível' });
        }
    });

    app.post('/api/telemetria', async (req, res) => {
        // Regra de Ouro: nenhum pacote chega ao banco sem passar pelo validador LGPD
        const resultado = validarTelemetria(req.body);

        if (!resultado.sucesso) {
            return res.status(400).json({ erro: resultado.erro });
        }

        const parametros = paraParametrosTelemetria(resultado.dados);

        if (!parametros) {
            return res.status(400).json({ erro: 'Estrutura inválida', detalhe: 'As métricas têm de ser números inteiros.' });
        }

        const { rows } = await db.query(SQL_INSERIR_TELEMETRIA, parametros);

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Colaborador não encontrado ou inativo' });
        }

        res.status(201).json({
            mensagem: 'Telemetria registada com sucesso',
            id: rows[0].id,
            data_coleta: rows[0].data_coleta
        });
    });

    app.use((req, res) => {
        res.status(404).json({ erro: 'Rota não encontrada' });
    });

    // O Express só reconhece um handler de erros com 4 argumentos, por isso o `next` tem de ficar
    app.use((erro, req, res, next) => {
        if (erro.type === 'entity.parse.failed') {
            return res.status(400).json({ erro: 'JSON malformado' });
        }

        if (erro.type === 'entity.too.large') {
            return res.status(413).json({ erro: 'Payload demasiado grande' });
        }

        // Nunca registar o corpo do pedido: pode conter dados que o validador ainda não filtrou
        console.error('🔴 [API] Erro interno:', erro.code || erro.message);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    });

    return app;
}

module.exports = { createApp, SQL_INSERIR_TELEMETRIA };
