const express = require('express');
const { validarTelemetria } = require('../../src/validador');
const { exigirChaveApi } = require('../middlewares/autenticacao');

// Insere o lote inteiro em uma única instrução (atômica): o unnest transforma os arrays em linhas
// e cada hash anônimo é resolvido para o colaborador ativo correspondente.
// Se algum hash não existir (ou o colaborador estiver inativo), a condição final falha
// e nenhuma linha é inserida, nem mesmo as válidas.
const SQL_INSERIR_TELEMETRIA = `
    WITH entrada AS (
        SELECT *
        FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::timestamptz[])
            WITH ORDINALITY AS e(codigo_anonimo, dwell_time, flight_time, mouse_speed, data_coleta, ordem)
    ),
    resolvida AS (
        SELECT c.id AS colaborador_id, e.*
        FROM entrada e
        JOIN colaborador c
          ON c.codigo_anonimo = e.codigo_anonimo
         AND c.ativo
    )
    INSERT INTO telemetria (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta)
    SELECT colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta
    FROM resolvida
    WHERE (SELECT count(*) FROM resolvida) = (SELECT count(*) FROM entrada)
    ORDER BY ordem
    RETURNING id, data_coleta;
`;

// Valida cada pacote com o validador LGPD e monta os arrays de parâmetros da query.
// Um único pacote inválido rejeita o lote inteiro: o coletor é nosso, então um pacote
// fora do contrato indica defeito ou adulteração, e não deve ser gravado pela metade.
function validarLote(pacotes) {
    const colunas = [[], [], [], [], []];

    for (const [indice, pacote] of pacotes.entries()) {
        const resultado = validarTelemetria(pacote);

        if (!resultado.sucesso) {
            return { status: 400, corpo: { erro: resultado.erro, indice } };
        }

        const dados = resultado.dados;
        const metricas = [dados.tempo_pressao_ms, dados.tempo_voo_ms, dados.velocidade_rato_px];

        // As colunas dwell_time, flight_time e mouse_speed são INTEGER: valores decimais são
        // rejeitados em vez de arredondados silenciosamente pelo PostgreSQL.
        if (!metricas.every(Number.isInteger)) {
            return {
                status: 400,
                corpo: { erro: 'Estrutura inválida', detalhe: 'As métricas devem ser números inteiros.', indice }
            };
        }

        [dados.id_usuario, ...metricas, dados.data_evento].forEach((valor, coluna) => colunas[coluna].push(valor));
    }

    return { parametros: colunas };
}

function criarRotasTelemetria({ db, config, limites }) {
    const rotas = express.Router();

    /**
     * @openapi
     * /api/telemetria:
     *   post:
     *     summary: Registra um pacote ou um lote de telemetria comportamental
     *     description: |
     *       Exclusiva do coletor oficial (cabeçalho `X-API-Key`).
     *
     *       Aceita **um objeto** ou **um array de objetos** (lote). Cada pacote passa pelo validador LGPD;
     *       campos fora do contrato (ex.: `tecla`, `texto`) ou e-mail no `userId` bloqueiam o envio.
     *
     *       O lote é **atômico**: se um pacote for inválido ou um `userId` não pertencer a um colaborador
     *       ativo, nada é gravado. Nos erros 400 de lote, `indice` aponta o pacote com problema.
     *     tags: [Telemetria]
     *     security:
     *       - chaveApi: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             oneOf:
     *               - $ref: '#/components/schemas/Telemetria'
     *               - type: array
     *                 minItems: 1
     *                 maxItems: 1000
     *                 items:
     *                   $ref: '#/components/schemas/Telemetria'
     *           examples:
     *             pacote:
     *               summary: Um pacote
     *               value:
     *                 userId: a2a0159acf6ac55f05c0c4d4bdc54004
     *                 timestamp: 1790723199823
     *                 dwellTime: 103
     *                 flightTime: 68
     *                 mouseSpeed: 476
     *             lote:
     *               summary: Lote de pacotes
     *               value:
     *                 - { userId: a2a0159acf6ac55f05c0c4d4bdc54004, timestamp: 1790723199823, dwellTime: 103, flightTime: 68, mouseSpeed: 476 }
     *                 - { userId: a2a0159acf6ac55f05c0c4d4bdc54004, timestamp: 1790723200310, dwellTime: 97, flightTime: 74, mouseSpeed: 455 }
     *     responses:
     *       201:
     *         description: Telemetria validada e registrada
     *         content:
     *           application/json:
     *             schema:
     *               oneOf:
     *                 - $ref: '#/components/schemas/TelemetriaCriada'
     *                 - $ref: '#/components/schemas/LoteCriado'
     *       400:
     *         description: Pacote rejeitado pelo validador, lote vazio ou JSON inválido
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Erro'
     *             examples:
     *               violacaoLgpd:
     *                 summary: Campo proibido ou e-mail no userId
     *                 value: { erro: Violação de LGPD }
     *               violacaoLgpdLote:
     *                 summary: Campo proibido no 3º pacote do lote
     *                 value: { erro: Violação de LGPD, indice: 2 }
     *               estruturaInvalida:
     *                 summary: Campo ausente, métrica em texto ou negativa
     *                 value: { erro: Estrutura inválida }
     *               metricaDecimal:
     *                 summary: Métrica com casas decimais
     *                 value: { erro: Estrutura inválida, detalhe: As métricas devem ser números inteiros. }
     *               loteVazio:
     *                 summary: Array sem pacotes
     *                 value: { erro: Lote vazio }
     *               jsonMalformado:
     *                 summary: Corpo não é um JSON válido
     *                 value: { erro: JSON malformado }
     *       401:
     *         $ref: '#/components/responses/ChaveApiInvalida'
     *       404:
     *         description: Algum userId não corresponde a um colaborador ativo (nada foi gravado)
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Erro'
     *             example: { erro: Colaborador não encontrado ou inativo }
     *       413:
     *         description: Corpo acima de 256kb ou lote acima de 1000 pacotes
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Erro'
     *             examples:
     *               payload:
     *                 value: { erro: Payload muito grande }
     *               lote:
     *                 value: { erro: Lote muito grande, detalhe: O lote aceita no máximo 1000 pacotes. }
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     *       503:
     *         description: API_KEY não configurada no servidor (rota fechada por segurança)
     */
    rotas.post('/api/telemetria', limites.telemetria, exigirChaveApi(config), async (req, res) => {
        const ehLote = Array.isArray(req.body);
        const pacotes = ehLote ? req.body : [req.body];

        if (ehLote && pacotes.length === 0) {
            return res.status(400).json({ erro: 'Lote vazio' });
        }

        if (pacotes.length > config.loteMaximo) {
            return res.status(413).json({
                erro: 'Lote muito grande',
                detalhe: `O lote aceita no máximo ${config.loteMaximo} pacotes.`
            });
        }

        // Regra de Ouro: nenhum pacote chega ao banco sem passar pelo validador LGPD
        const lote = validarLote(pacotes);

        if (!lote.parametros) {
            // Para um objeto único, o índice não acrescenta nada e mantém a resposta original
            if (!ehLote) delete lote.corpo.indice;
            return res.status(lote.status).json(lote.corpo);
        }

        const { rows } = await db.query(SQL_INSERIR_TELEMETRIA, lote.parametros);

        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Colaborador não encontrado ou inativo' });
        }

        if (!ehLote) {
            return res.status(201).json({
                mensagem: 'Telemetria registrada com sucesso',
                id: rows[0].id,
                data_coleta: rows[0].data_coleta
            });
        }

        res.status(201).json({
            mensagem: 'Lote de telemetria registrado com sucesso',
            quantidade: rows.length,
            ids: rows.map((linha) => linha.id)
        });
    });

    return rotas;
}

module.exports = { criarRotasTelemetria, SQL_INSERIR_TELEMETRIA };
