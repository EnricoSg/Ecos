const express = require('express');
const { exigirJwt } = require('../middlewares/autenticacao');
const { lerInteiroPositivo, lerTextoOpcional } = require('../utils/consulta');

const STATUS_ALERTA = ['PENDENTE', 'RESOLVIDO'];

// Alerta + anomalia de origem + colaborador (apenas hash anônimo e setor, nunca dados pessoais).
// O COUNT(*) OVER() devolve o total filtrado em cada linha, para a paginação sem uma segunda query.
const SQL_LISTAR_ALERTAS = `
    SELECT
        al.id,
        al.status,
        al.mensagem,
        al.data_criacao,
        al.data_resolucao,
        an.id AS anomalia_id,
        an.nivel,
        an.pontuacao_desvio::float8 AS pontuacao_desvio,
        an.data_deteccao,
        c.codigo_anonimo,
        c.setor,
        COUNT(*) OVER()::int AS total
    FROM alerta al
    JOIN anomalia an ON an.id = al.anomalia_id
    JOIN colaborador c ON c.id = an.colaborador_id
    WHERE ($1::text IS NULL OR al.status = $1)
      AND ($2::text IS NULL OR c.setor = $2)
    ORDER BY al.data_criacao DESC, al.id DESC
    LIMIT $3 OFFSET $4;
`;

// Só resolve alertas pendentes: um alerta já resolvido mantém a data_resolucao original
const SQL_RESOLVER_ALERTA = `
    UPDATE alerta
    SET status = 'RESOLVIDO',
        data_resolucao = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status = 'PENDENTE'
    RETURNING id, status, mensagem, data_criacao, data_resolucao;
`;

const SQL_STATUS_ALERTA = 'SELECT status FROM alerta WHERE id = $1;';

function formatarAlerta(linha) {
    return {
        id: linha.id,
        status: linha.status,
        mensagem: linha.mensagem,
        data_criacao: linha.data_criacao,
        data_resolucao: linha.data_resolucao,
        anomalia: {
            id: linha.anomalia_id,
            nivel: linha.nivel,
            pontuacao_desvio: linha.pontuacao_desvio,
            data_deteccao: linha.data_deteccao
        },
        colaborador: {
            codigo_anonimo: linha.codigo_anonimo,
            setor: linha.setor
        }
    };
}

function criarRotasAlertas({ db, config, limites }) {
    const rotas = express.Router();
    const protecao = [limites.leitura, exigirJwt(config)];

    /**
     * @openapi
     * /api/alertas:
     *   get:
     *     summary: Lista os alertas com a anomalia e o colaborador (anonimizado) de origem
     *     tags: [Alertas]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: status
     *         schema: { type: string, enum: [PENDENTE, RESOLVIDO] }
     *       - in: query
     *         name: setor
     *         schema: { type: string }
     *         example: TI
     *       - in: query
     *         name: limite
     *         description: Itens por página (máximo 200)
     *         schema: { type: integer, default: 50, minimum: 1, maximum: 200 }
     *       - in: query
     *         name: pagina
     *         schema: { type: integer, default: 1, minimum: 1 }
     *     responses:
     *       200:
     *         description: Página de alertas, do mais recente para o mais antigo
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 total: { type: integer, example: 1 }
     *                 pagina: { type: integer, example: 1 }
     *                 limite: { type: integer, example: 50 }
     *                 alertas:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/Alerta'
     *       400:
     *         $ref: '#/components/responses/ParametroInvalido'
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.get('/api/alertas', protecao, async (req, res) => {
        const status = lerTextoOpcional(req.query.status, 'status');
        const setor = lerTextoOpcional(req.query.setor, 'setor');
        const limite = lerInteiroPositivo(req.query.limite, { padrao: 50, maximo: 200, nome: 'limite' });
        const pagina = lerInteiroPositivo(req.query.pagina, { padrao: 1, nome: 'pagina' });

        const erro = [status, setor, limite, pagina].find((parametro) => parametro.erro);
        if (erro) {
            return res.status(400).json({ erro: 'Parâmetro inválido', detalhe: erro.erro });
        }

        if (status.valor && !STATUS_ALERTA.includes(status.valor)) {
            return res.status(400).json({
                erro: 'Parâmetro inválido',
                detalhe: `O parâmetro "status" deve ser um destes: ${STATUS_ALERTA.join(', ')}.`
            });
        }

        const deslocamento = (pagina.valor - 1) * limite.valor;
        const { rows } = await db.query(SQL_LISTAR_ALERTAS, [status.valor, setor.valor, limite.valor, deslocamento]);

        res.json({
            total: rows.length > 0 ? rows[0].total : 0,
            pagina: pagina.valor,
            limite: limite.valor,
            alertas: rows.map(formatarAlerta)
        });
    });

    /**
     * @openapi
     * /api/alertas/{id}:
     *   patch:
     *     summary: Marca um alerta como RESOLVIDO e grava a data de resolução
     *     tags: [Alertas]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: integer, minimum: 1 }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [status]
     *             properties:
     *               status: { type: string, enum: [RESOLVIDO] }
     *           example: { status: RESOLVIDO }
     *     responses:
     *       200:
     *         description: Alerta resolvido
     *         content:
     *           application/json:
     *             example:
     *               mensagem: Alerta marcado como resolvido
     *               alerta: { id: 7, status: RESOLVIDO, mensagem: Desvio comportamental de nível alto detectado., data_criacao: '2026-10-10T14:00:00.000Z', data_resolucao: '2026-10-12T15:30:00.000Z' }
     *       400:
     *         description: id inválido ou status diferente de RESOLVIDO
     *         content:
     *           application/json:
     *             example: { erro: Requisição inválida, detalhe: 'Envie { "status": "RESOLVIDO" } no corpo.' }
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       404:
     *         description: Alerta inexistente
     *         content:
     *           application/json:
     *             example: { erro: Alerta não encontrado }
     *       409:
     *         description: O alerta já estava resolvido
     *         content:
     *           application/json:
     *             example: { erro: O alerta já está resolvido }
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.patch('/api/alertas/:id', protecao, async (req, res) => {
        const id = lerInteiroPositivo(req.params.id, { maximo: 2147483647, nome: 'id' });

        if (id.erro) {
            return res.status(400).json({ erro: 'Requisição inválida', detalhe: id.erro });
        }

        if (req.body?.status !== 'RESOLVIDO') {
            return res.status(400).json({ erro: 'Requisição inválida', detalhe: 'Envie { "status": "RESOLVIDO" } no corpo.' });
        }

        const { rows } = await db.query(SQL_RESOLVER_ALERTA, [id.valor]);

        if (rows.length > 0) {
            return res.json({ mensagem: 'Alerta marcado como resolvido', alerta: rows[0] });
        }

        // Nada foi atualizado: descobre se o alerta não existe ou se já estava resolvido
        const existente = await db.query(SQL_STATUS_ALERTA, [id.valor]);

        if (existente.rows.length === 0) {
            return res.status(404).json({ erro: 'Alerta não encontrado' });
        }

        res.status(409).json({ erro: 'O alerta já está resolvido' });
    });

    return rotas;
}

module.exports = { criarRotasAlertas, SQL_LISTAR_ALERTAS, SQL_RESOLVER_ALERTA, SQL_STATUS_ALERTA };
