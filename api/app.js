const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { lerConfig } = require('./config');
const { criarLimites } = require('./middlewares/limites');
const { criarRotasTelemetria } = require('./rotas/telemetria');
const { criarRotasAutenticacao } = require('./rotas/autenticacao');
const { criarRotasAlertas } = require('./rotas/alertas');
const { criarRotasAnalises } = require('./rotas/analises');
const { especificacao } = require('./swagger');

// Comporta um lote de até 1000 pacotes (cerca de 110 bytes cada) com folga
const LIMITE_CORPO = '256kb';

function createApp(db, config = lerConfig()) {
    const app = express();
    const limites = criarLimites(config);
    const dependencias = { db, config, limites };

    app.use(cors({ origin: config.corsOrigem }));
    app.use(express.json({ limit: LIMITE_CORPO }));

    // Documentação interativa (Swagger UI) e especificação OpenAPI em JSON
    app.get('/api-docs.json', (req, res) => res.json(especificacao));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(especificacao, {
        swaggerOptions: { persistAuthorization: true }
    }));

    /**
     * @openapi
     * /api/health:
     *   get:
     *     summary: Verifica se a API e o banco estão disponíveis
     *     tags: [Saúde]
     *     responses:
     *       200:
     *         description: API e banco operacionais
     *         content:
     *           application/json:
     *             example: { status: ok, banco: conectado }
     *       503:
     *         description: Banco indisponível
     *         content:
     *           application/json:
     *             example: { status: erro, banco: indisponível }
     */
    app.get('/api/health', async (req, res) => {
        try {
            await db.query('SELECT 1');
            res.json({ status: 'ok', banco: 'conectado' });
        } catch {
            res.status(503).json({ status: 'erro', banco: 'indisponível' });
        }
    });

    app.use(criarRotasTelemetria(dependencias));
    app.use(criarRotasAutenticacao(dependencias));
    app.use(criarRotasAlertas(dependencias));
    app.use(criarRotasAnalises(dependencias));

    app.use((req, res) => {
        res.status(404).json({ erro: 'Rota não encontrada' });
    });

    // O Express só reconhece um handler de erros com 4 argumentos, por isso o `next` precisa ficar
    app.use((erro, req, res, next) => {
        if (erro.type === 'entity.parse.failed') {
            return res.status(400).json({ erro: 'JSON malformado' });
        }

        if (erro.type === 'entity.too.large') {
            return res.status(413).json({ erro: 'Payload muito grande' });
        }

        // Nunca registrar o corpo da requisição: pode conter dados que o validador ainda não filtrou
        console.error('🔴 [API] Erro interno:', erro.code || erro.message);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    });

    return app;
}

module.exports = { createApp };
