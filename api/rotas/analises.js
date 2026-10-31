const express = require('express');
const { exigirJwt } = require('../middlewares/autenticacao');
const { lerPeriodo, lerTextoOpcional } = require('../utils/consulta');

// Rotas analíticas do Dashboard: devolvem apenas dados agregados, nunca eventos individuais brutos.

// Contagem de anomalias por período e nível, opcionalmente filtrada por setor
const SQL_ANOMALIAS_AGREGADAS = `
    SELECT
        date_trunc($1::text, an.data_deteccao)::timestamptz AS periodo,
        COUNT(*) FILTER (WHERE an.nivel = 'BAIXO')::int AS baixo,
        COUNT(*) FILTER (WHERE an.nivel = 'MEDIO')::int AS medio,
        COUNT(*) FILTER (WHERE an.nivel = 'ALTO')::int AS alto,
        COUNT(*)::int AS total,
        COUNT(DISTINCT an.colaborador_id)::int AS colaboradores,
        ROUND(AVG(an.pontuacao_desvio), 4)::float8 AS pontuacao_media
    FROM anomalia an
    JOIN colaborador c ON c.id = an.colaborador_id
    WHERE an.data_deteccao >= $2::timestamptz
      AND an.data_deteccao < $3::timestamptz
      AND ($4::text IS NULL OR c.setor = $4)
    GROUP BY 1
    ORDER BY 1;
`;

// Setores com colaboradores ativos e quantos alertas pendentes cada um tem (para filtros do Dashboard)
const SQL_LISTAR_SETORES = `
    SELECT
        c.setor,
        COUNT(DISTINCT c.id)::int AS colaboradores,
        COUNT(al.id) FILTER (WHERE al.status = 'PENDENTE')::int AS alertas_pendentes
    FROM colaborador c
    LEFT JOIN anomalia an ON an.colaborador_id = c.id
    LEFT JOIN alerta al ON al.anomalia_id = an.id
    WHERE c.ativo
      AND c.setor IS NOT NULL
    GROUP BY c.setor
    ORDER BY c.setor;
`;

// Quantidade de colaboradores ativos do setor e a média do baseline mais recente de cada um
const SQL_RESUMO_SETOR = `
    WITH colaboradores_setor AS (
        SELECT id FROM colaborador WHERE setor = $1 AND ativo
    ),
    baseline_atual AS (
        SELECT DISTINCT ON (b.colaborador_id) b.*
        FROM baseline b
        WHERE b.colaborador_id IN (SELECT id FROM colaboradores_setor)
        ORDER BY b.colaborador_id, b.data_calculo DESC, b.id DESC
    )
    SELECT
        (SELECT COUNT(*)::int FROM colaboradores_setor) AS colaboradores,
        ROUND(AVG(media_dwell_time), 2)::float8 AS media_dwell_time,
        ROUND(AVG(media_flight_time), 2)::float8 AS media_flight_time,
        ROUND(AVG(media_mouse_speed), 2)::float8 AS media_mouse_speed
    FROM baseline_atual;
`;

// Série temporal do setor: média das métricas e quantidade de anomalias por período
const SQL_TENDENCIA_SETOR = `
    WITH colaboradores_setor AS (
        SELECT id FROM colaborador WHERE setor = $1 AND ativo
    ),
    metricas AS (
        SELECT
            date_trunc($2::text, t.data_coleta) AS periodo,
            ROUND(AVG(t.dwell_time), 2)::float8 AS media_dwell_time,
            ROUND(AVG(t.flight_time), 2)::float8 AS media_flight_time,
            ROUND(AVG(t.mouse_speed), 2)::float8 AS media_mouse_speed,
            COUNT(*)::int AS eventos,
            COUNT(DISTINCT t.colaborador_id)::int AS colaboradores
        FROM telemetria t
        WHERE t.colaborador_id IN (SELECT id FROM colaboradores_setor)
          AND t.data_coleta >= $3::timestamptz
          AND t.data_coleta < $4::timestamptz
        GROUP BY 1
    ),
    anomalias AS (
        SELECT
            date_trunc($2::text, an.data_deteccao)::timestamptz AS periodo,
            COUNT(*)::int AS anomalias
        FROM anomalia an
        WHERE an.colaborador_id IN (SELECT id FROM colaboradores_setor)
          AND an.data_deteccao >= $3::timestamptz
          AND an.data_deteccao < $4::timestamptz
        GROUP BY 1
    )
    SELECT
        periodo,
        m.media_dwell_time,
        m.media_flight_time,
        m.media_mouse_speed,
        COALESCE(m.eventos, 0) AS eventos,
        COALESCE(m.colaboradores, 0) AS colaboradores,
        COALESCE(a.anomalias, 0) AS anomalias
    FROM metricas m
    FULL JOIN anomalias a USING (periodo)
    ORDER BY periodo;
`;

function responderParametroInvalido(res, detalhe) {
    return res.status(400).json({ erro: 'Parâmetro inválido', detalhe });
}

// Privacidade: setor com poucos colaboradores ativos não pode ter dados agregados exibidos
function grupoPequenoDemais(config, colaboradores) {
    const minimo = config.minColaboradoresSetor ?? 1;
    return minimo > 1 && colaboradores < minimo;
}

function responderGrupoPequeno(res, config) {
    return res.status(403).json({
        erro: 'Grupo pequeno demais',
        detalhe: `Para proteger a privacidade, dados agregados só são exibidos para setores com pelo menos ${config.minColaboradoresSetor} colaboradores ativos.`
    });
}

function criarRotasAnalises({ db, config, limites }) {
    const rotas = express.Router();
    const protecao = [limites.leitura, exigirJwt(config)];

    /**
     * @openapi
     * /api/anomalias:
     *   get:
     *     summary: Anomalias agregadas por período e nível (gráfico de tendência geral)
     *     tags: [Análises]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - $ref: '#/components/parameters/Inicio'
     *       - $ref: '#/components/parameters/Fim'
     *       - $ref: '#/components/parameters/Agrupamento'
     *       - in: query
     *         name: setor
     *         schema: { type: string }
     *         example: TI
     *     responses:
     *       200:
     *         description: Série temporal de anomalias (períodos sem anomalias não aparecem)
     *         content:
     *           application/json:
     *             example:
     *               inicio: '2026-09-12T00:00:00.000Z'
     *               fim: '2026-10-12T00:00:00.000Z'
     *               agrupamento: dia
     *               setor: null
     *               serie:
     *                 - { periodo: '2026-10-10T00:00:00.000Z', baixo: 3, medio: 2, alto: 1, total: 6, colaboradores: 2, pontuacao_media: 0.1832 }
     *       400:
     *         $ref: '#/components/responses/ParametroInvalido'
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.get('/api/anomalias', protecao, async (req, res) => {
        const periodo = lerPeriodo(req.query);
        if (periodo.erro) return responderParametroInvalido(res, periodo.erro);

        const setor = lerTextoOpcional(req.query.setor, 'setor');
        if (setor.erro) return responderParametroInvalido(res, setor.erro);

        if (setor.valor && (config.minColaboradoresSetor ?? 1) > 1) {
            const resumo = await db.query(SQL_RESUMO_SETOR, [setor.valor]);
            if (grupoPequenoDemais(config, resumo.rows[0].colaboradores)) {
                return responderGrupoPequeno(res, config);
            }
        }

        const { inicio, fim, agrupamento, unidadeSql } = periodo.valor;
        const { rows } = await db.query(SQL_ANOMALIAS_AGREGADAS, [unidadeSql, inicio, fim, setor.valor]);

        res.json({ inicio, fim, agrupamento, setor: setor.valor, serie: rows });
    });

    /**
     * @openapi
     * /api/setores:
     *   get:
     *     summary: Lista os setores com colaboradores ativos e alertas pendentes
     *     tags: [Análises]
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Setores em ordem alfabética
     *         content:
     *           application/json:
     *             example:
     *               setores:
     *                 - { setor: TI, colaboradores: 2, alertas_pendentes: 3 }
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.get('/api/setores', protecao, async (req, res) => {
        const { rows } = await db.query(SQL_LISTAR_SETORES);
        res.json({ setores: rows });
    });

    /**
     * @openapi
     * /api/setores/{setor}/tendencia:
     *   get:
     *     summary: Tendência das métricas de um setor comparada ao baseline
     *     description: |
     *       Média de dwell time, flight time e velocidade do mouse do setor por período,
     *       com a quantidade de anomalias, e a média do baseline mais recente dos colaboradores do setor
     *       como linha de referência para o gráfico.
     *     tags: [Análises]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: setor
     *         required: true
     *         schema: { type: string }
     *         example: TI
     *       - $ref: '#/components/parameters/Inicio'
     *       - $ref: '#/components/parameters/Fim'
     *       - $ref: '#/components/parameters/Agrupamento'
     *     responses:
     *       200:
     *         description: Baseline do setor e série temporal
     *         content:
     *           application/json:
     *             example:
     *               setor: TI
     *               inicio: '2026-09-12T00:00:00.000Z'
     *               fim: '2026-10-12T00:00:00.000Z'
     *               agrupamento: dia
     *               colaboradores: 2
     *               baseline: { media_dwell_time: 98.5, media_flight_time: 71.25, media_mouse_speed: 462 }
     *               serie:
     *                 - { periodo: '2026-10-10T00:00:00.000Z', media_dwell_time: 121.4, media_flight_time: 95.1, media_mouse_speed: 390.2, eventos: 400, colaboradores: 2, anomalias: 4 }
     *       400:
     *         $ref: '#/components/responses/ParametroInvalido'
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       404:
     *         description: Setor sem colaboradores ativos
     *         content:
     *           application/json:
     *             example: { erro: Setor não encontrado }
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.get('/api/setores/:setor/tendencia', protecao, async (req, res) => {
        const setor = lerTextoOpcional(req.params.setor, 'setor');
        if (setor.erro) return responderParametroInvalido(res, setor.erro);

        const periodo = lerPeriodo(req.query);
        if (periodo.erro) return responderParametroInvalido(res, periodo.erro);

        const { inicio, fim, agrupamento, unidadeSql } = periodo.valor;
        const resumo = await db.query(SQL_RESUMO_SETOR, [setor.valor]);
        const { colaboradores, ...baseline } = resumo.rows[0];

        if (colaboradores === 0) {
            return res.status(404).json({ erro: 'Setor não encontrado' });
        }

        if (grupoPequenoDemais(config, colaboradores)) {
            return responderGrupoPequeno(res, config);
        }

        const serie = await db.query(SQL_TENDENCIA_SETOR, [setor.valor, unidadeSql, inicio, fim]);

        res.json({
            setor: setor.valor,
            inicio,
            fim,
            agrupamento,
            colaboradores,
            baseline,
            serie: serie.rows
        });
    });

    return rotas;
}

module.exports = {
    criarRotasAnalises,
    SQL_ANOMALIAS_AGREGADAS,
    SQL_LISTAR_SETORES,
    SQL_RESUMO_SETOR,
    SQL_TENDENCIA_SETOR
};
