const express = require('express');
const { exigirJwt } = require('../middlewares/autenticacao');
const { lerInteiroPositivo, lerTextoOpcional } = require('../utils/consulta');

const AVISO = 'Desvio estatístico em relação ao padrão do próprio colaborador. Não é diagnóstico clínico.';

// Números dos cards do Dashboard. Sem alertas, o agregado devolve uma linha com zeros (e média nula).
const SQL_RESUMO_ALERTAS = `
    SELECT
        COUNT(*) FILTER (WHERE al.status = 'PENDENTE')::int AS pendentes,
        COUNT(*) FILTER (WHERE al.status = 'RESOLVIDO')::int AS resolvidos,
        COUNT(*) FILTER (WHERE al.status = 'PENDENTE' AND an.nivel = 'ALTO')::int AS pendentes_alto,
        COUNT(*) FILTER (WHERE al.status = 'PENDENTE' AND an.nivel = 'MEDIO')::int AS pendentes_medio,
        ROUND((AVG(EXTRACT(EPOCH FROM (al.data_resolucao - al.data_criacao)))
               FILTER (WHERE al.status = 'RESOLVIDO') / 3600)::numeric, 1)::float8 AS horas_medias_ate_resolver
    FROM alerta al
    JOIN anomalia an ON an.id = al.anomalia_id
    JOIN colaborador c ON c.id = an.colaborador_id
    WHERE ($1::text IS NULL OR c.setor = $1);
`;

// Mesma regra do motor de IA (ai/anomaly_detector.py, media_aparada): descarta os 10% extremos de cada lado
const PROPORCAO_CORTE = 0.10;

// Alerta + a JANELA de telemetria que o disparou + o baseline usado na comparação.
//
// A IA avalia janelas de tempo (padrão: 15 min), não teclas isoladas, e grava em anomalia.telemetria_id
// apenas o ÚLTIMO evento da janela. Por isso a janela é reconstruída aqui com a mesma regra da IA:
//   - início = data_coleta desse evento arredondada para baixo em blocos de $2 segundos desde a época Unix
//     (equivale ao pandas .dt.floor() usado na IA);
//   - só entram os eventos que a IA avaliou JUNTOS com esse evento: a IA marca todo o grupo no mesmo UPDATE,
//     então todos têm o mesmo analisada_em (now() da transação). Isso separa, dentro da mesma janela de relógio,
//     eventos que chegaram depois ou que foram analisados em outra execução;
//   - valor observado = média aparada (percentis $3 e 1-$3, mesmo percentile_cont da IA) de cada métrica.
// Assim os percentuais batem com os da mensagem gerada pela IA.
//
// Todas as FKs são NOT NULL, então os JOIN internos nunca escondem um alerta existente.
const SQL_DETALHE_ALERTA = `
    WITH alvo AS (
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
            an.colaborador_id,
            c.codigo_anonimo,
            c.setor,
            b.media_dwell_time::float8 AS base_dwell_time,
            b.media_flight_time::float8 AS base_flight_time,
            b.media_mouse_speed::float8 AS base_mouse_speed,
            b.data_calculo,
            t.analisada_em,
            to_timestamp(floor(EXTRACT(EPOCH FROM t.data_coleta) / $2) * $2) AS janela_inicio
        FROM alerta al
        JOIN anomalia an ON an.id = al.anomalia_id
        JOIN colaborador c ON c.id = an.colaborador_id
        JOIN telemetria t ON t.id = an.telemetria_id
        JOIN baseline b ON b.id = an.baseline_id
        WHERE al.id = $1
    ),
    eventos AS (
        SELECT t.dwell_time, t.flight_time, t.mouse_speed
        FROM telemetria t
        JOIN alvo ON t.colaborador_id = alvo.colaborador_id
        WHERE t.data_coleta >= alvo.janela_inicio
          AND t.data_coleta < alvo.janela_inicio + make_interval(secs => $2)
          AND t.analisada_em IS NOT DISTINCT FROM alvo.analisada_em
    ),
    quantis AS (
        SELECT
            COUNT(*)::int AS eventos,
            percentile_cont(ARRAY[$3::float8, 1 - $3::float8]) WITHIN GROUP (ORDER BY dwell_time) AS q_dwell,
            percentile_cont(ARRAY[$3::float8, 1 - $3::float8]) WITHIN GROUP (ORDER BY flight_time) AS q_flight,
            percentile_cont(ARRAY[$3::float8, 1 - $3::float8]) WITHIN GROUP (ORDER BY mouse_speed) AS q_mouse
        FROM eventos
    )
    SELECT
        alvo.id, alvo.status, alvo.mensagem, alvo.data_criacao, alvo.data_resolucao,
        alvo.anomalia_id, alvo.nivel, alvo.pontuacao_desvio, alvo.data_deteccao,
        alvo.codigo_anonimo, alvo.setor,
        alvo.base_dwell_time, alvo.base_flight_time, alvo.base_mouse_speed, alvo.data_calculo,
        alvo.janela_inicio,
        alvo.janela_inicio + make_interval(secs => $2) AS janela_fim,
        q.eventos,
        (SELECT AVG(dwell_time) FROM eventos WHERE dwell_time BETWEEN q.q_dwell[1] AND q.q_dwell[2])::float8 AS obs_dwell_time,
        (SELECT AVG(flight_time) FROM eventos WHERE flight_time BETWEEN q.q_flight[1] AND q.q_flight[2])::float8 AS obs_flight_time,
        (SELECT AVG(mouse_speed) FROM eventos WHERE mouse_speed BETWEEN q.q_mouse[1] AND q.q_mouse[2])::float8 AS obs_mouse_speed
    FROM alvo
    CROSS JOIN quantis q;
`;

function arredondar(valor, casas = 2) {
    if (valor === null || valor === undefined) return null;
    const fator = 10 ** casas;
    return Math.round(valor * fator) / fator;
}

// Quanto o valor observado se afasta do baseline, em % com uma casa decimal (null se não der para calcular)
function variacaoPercentual(observado, base) {
    if (observado === null || observado === undefined || !base) {
        return null;
    }

    return Math.round(((observado - base) / base) * 1000) / 10;
}

function criarRotasAlertasDetalhe({ db, config, limites }) {
    const rotas = express.Router();
    const protecao = [limites.leitura, exigirJwt(config)];

    /**
     * @openapi
     * /api/alertas/resumo:
     *   get:
     *     summary: Contadores de alertas para os cards do Dashboard
     *     tags: [Alertas]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: setor
     *         schema: { type: string }
     *         example: TI
     *     responses:
     *       200:
     *         description: Totais de alertas pendentes e resolvidos
     *         content:
     *           application/json:
     *             example:
     *               setor: null
     *               pendentes: 5
     *               resolvidos: 12
     *               pendentes_alto: 2
     *               pendentes_medio: 3
     *               horas_medias_ate_resolver: 26.4
     *       400:
     *         $ref: '#/components/responses/ParametroInvalido'
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    // Precisa vir antes de /api/alertas/:id, senão "resumo" seria lido como um id
    rotas.get('/api/alertas/resumo', protecao, async (req, res) => {
        const setor = lerTextoOpcional(req.query.setor, 'setor');
        if (setor.erro) {
            return res.status(400).json({ erro: 'Parâmetro inválido', detalhe: setor.erro });
        }

        const { rows } = await db.query(SQL_RESUMO_ALERTAS, [setor.valor]);
        res.json({ setor: setor.valor, ...rows[0] });
    });

    /**
     * @openapi
     * /api/alertas/{id}:
     *   get:
     *     summary: Detalhe de um alerta, comparando a janela de tempo que o disparou com o baseline do colaborador
     *     description: |
     *       Explica ao RH **por que** o alerta existe: devolve o baseline do colaborador, a média aparada
     *       da janela de tempo avaliada pela IA (padrão: 15 min, variável `IA_JANELA_MINUTOS`) e a variação
     *       percentual, que é a mesma citada na mensagem do alerta.
     *       É um desvio estatístico em relação ao padrão do próprio colaborador, nunca um diagnóstico clínico.
     *     tags: [Alertas]
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: integer, minimum: 1 }
     *     responses:
     *       200:
     *         description: Alerta com a comparação baseline × observado
     *         content:
     *           application/json:
     *             example:
     *               id: 7
     *               status: PENDENTE
     *               mensagem: 'Desvio alto em 12/10 das 17:30 às 17:45: intervalo entre teclas +180%, tempo de pressão das teclas +35% em relação ao padrão do colaborador. Recomenda-se acompanhamento.'
     *               data_criacao: '2026-10-10T14:00:00.000Z'
     *               data_resolucao: null
     *               anomalia: { id: 15, nivel: ALTO, pontuacao_desvio: 3.220012, data_deteccao: '2026-10-10T13:59:00.000Z' }
     *               colaborador: { codigo_anonimo: a2a0159acf6ac55f05c0c4d4bdc54004, setor: TI }
     *               comparacao:
     *                 baseline: { dwell_time: 93.87, flight_time: 92.96, mouse_speed: 480.39, data_calculo: '2026-10-12T20:31:32.108Z' }
     *                 observado: { dwell_time: 126.62, flight_time: 260.03, mouse_speed: 319.67, eventos: 43, janela_inicio: '2026-10-12T20:30:00.000Z', janela_fim: '2026-10-12T20:45:00.000Z' }
     *                 variacao_percentual: { dwell_time: 34.9, flight_time: 179.7, mouse_speed: -33.5 }
     *               aviso: Desvio estatístico em relação ao padrão do próprio colaborador. Não é diagnóstico clínico.
     *       400:
     *         description: id inválido
     *         content:
     *           application/json:
     *             example: { erro: Requisição inválida, detalhe: 'O parâmetro "id" deve ser um número inteiro entre 1 e 2147483647.' }
     *       401:
     *         $ref: '#/components/responses/NaoAutenticado'
     *       404:
     *         description: Alerta inexistente
     *         content:
     *           application/json:
     *             example: { erro: Alerta não encontrado }
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       500:
     *         $ref: '#/components/responses/ErroInterno'
     */
    rotas.get('/api/alertas/:id', protecao, async (req, res) => {
        const id = lerInteiroPositivo(req.params.id, { maximo: 2147483647, nome: 'id' });
        if (id.erro) {
            return res.status(400).json({ erro: 'Requisição inválida', detalhe: id.erro });
        }

        const janelaSegundos = config.janelaAnaliseMin * 60;
        const { rows } = await db.query(SQL_DETALHE_ALERTA, [id.valor, janelaSegundos, PROPORCAO_CORTE]);
        if (rows.length === 0) {
            return res.status(404).json({ erro: 'Alerta não encontrado' });
        }

        const l = rows[0];

        res.json({
            id: l.id,
            status: l.status,
            mensagem: l.mensagem,
            data_criacao: l.data_criacao,
            data_resolucao: l.data_resolucao,
            anomalia: {
                id: l.anomalia_id,
                nivel: l.nivel,
                pontuacao_desvio: l.pontuacao_desvio,
                data_deteccao: l.data_deteccao
            },
            colaborador: { codigo_anonimo: l.codigo_anonimo, setor: l.setor },
            comparacao: {
                baseline: {
                    dwell_time: l.base_dwell_time,
                    flight_time: l.base_flight_time,
                    mouse_speed: l.base_mouse_speed,
                    data_calculo: l.data_calculo
                },
                // Média aparada da janela. A variação usa o valor sem arredondar, como a IA.
                observado: {
                    dwell_time: arredondar(l.obs_dwell_time),
                    flight_time: arredondar(l.obs_flight_time),
                    mouse_speed: arredondar(l.obs_mouse_speed),
                    eventos: l.eventos,
                    janela_inicio: l.janela_inicio,
                    janela_fim: l.janela_fim
                },
                variacao_percentual: {
                    dwell_time: variacaoPercentual(l.obs_dwell_time, l.base_dwell_time),
                    flight_time: variacaoPercentual(l.obs_flight_time, l.base_flight_time),
                    mouse_speed: variacaoPercentual(l.obs_mouse_speed, l.base_mouse_speed)
                }
            },
            aviso: AVISO
        });
    });

    return rotas;
}

module.exports = { criarRotasAlertasDetalhe, SQL_RESUMO_ALERTAS, SQL_DETALHE_ALERTA, PROPORCAO_CORTE, variacaoPercentual };
