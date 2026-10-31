const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
const { lerConfig } = require('./config');
const { criarLimites } = require('./middlewares/limites');
const { criarRotasTelemetria } = require('./rotas/telemetria');
const { criarRotasAutenticacao } = require('./rotas/autenticacao');
const { criarRotasAlertas } = require('./rotas/alertas');
const { criarRotasAlertasDetalhe } = require('./rotas/alertasDetalhe');
const { criarRotasAnalises } = require('./rotas/analises');
const { especificacao } = require('./swagger');

// Comporta um lote de até 1000 pacotes (cerca de 110 bytes cada) com folga
const LIMITE_CORPO = '256kb';

function createApp(db, config = lerConfig()) {
    const app = express();
    const limites = criarLimites(config);
    const dependencias = { db, config, limites };

    // Atrás de proxy reverso, sem isto o rate limit enxerga só o IP do proxy
    if (config.trustProxy) {
        app.set('trust proxy', config.trustProxy);
    }

    app.use(cors({ origin: config.corsOrigem }));
    app.use(express.json({ limit: LIMITE_CORPO }));

    // Documentação interativa (Swagger UI) e especificação OpenAPI em JSON.
    // Fica ANTES do helmet de propósito: a CSP padrão do helmet bloqueia os scripts do Swagger UI.
    if (config.docsHabilitadas !== false) {
        app.get('/api-docs.json', (req, res) => res.json(especificacao));
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(especificacao, {
            swaggerOptions: { persistAuthorization: true }
        }));
    }

    // Cabeçalhos de segurança (nosniff, HSTS, frame-ancestors...) e remoção do X-Powered-By
    app.use(helmet());

    // Respostas da API carregam dados de saúde ocupacional: nunca devem ficar em cache de navegador ou proxy
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

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
    // O detalhe/resumo vem antes de alertas.js só por organização; as rotas não se sobrepõem
    app.use(criarRotasAlertasDetalhe(dependencias));
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

        // Outros erros 4xx do próprio Express/body-parser (charset ou encoding não suportado, requisição abortada...)
        // são culpa do cliente e não podem virar um 500 "Erro interno"
        const status = erro.status ?? erro.statusCode;
        if (Number.isInteger(status) && status >= 400 && status < 500) {
            const mensagem = status === 415 ? 'Tipo de conteúdo não suportado' : 'Requisição inválida';
            return res.status(status).json({ erro: mensagem });
        }

        // Nunca registrar o corpo da requisição: pode conter dados que o validador ainda não filtrou
        console.error('🔴 [API] Erro interno:', erro.code || erro.message);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    });

    return app;
}

module.exports = { createApp };
