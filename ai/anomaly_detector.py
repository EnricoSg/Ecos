"""
ECOS - Motor de detecção de anomalias (leitura direta do PostgreSQL)

Fluxo de cada execução (tudo em UMA transação: ou grava tudo, ou nada):

  1. Lê as telemetrias ainda não analisadas (telemetria.analisada_em IS NULL).
  2. Agrupa os eventos de cada colaborador em janelas de tempo (padrão: 15 min).
     Uma tecla lenta isolada não indica fadiga; uma janela inteira mais lenta, sim.
  3. Compara cada janela com o baseline do colaborador (tabela baseline):
       z = (média aparada da janela - média do baseline) / dispersão típica do colaborador
     A dispersão típica é o desvio absoluto mediano (MAD) do histórico já analisado.
     pontuacao_desvio = raiz da média dos z² das três métricas.
  4. Define o nível pela pontuação (BAIXO, MEDIO, ALTO) e grava em anomalia.
     MEDIO e ALTO também geram um alerta PENDENTE para o RH.
  5. Marca as telemetrias como analisadas e renova baselines vencidos.

Por que não Isolation Forest com contamination=0.05 (versão anterior):
  - marcava 5% dos eventos como anomalia mesmo que todos estivessem bem;
  - não usava a tabela baseline;
  - pontuava tecla a tecla, então uma pausa para pensar já virava alerta ALTO.
O escore em relação ao baseline é explicável ao RH e ao colaborador ("a digitação
ficou 40% mais lenta que o seu padrão"), o que importa para a revisão de decisões
automatizadas (LGPD, art. 20).

LGPD: o script só lê tempos e velocidades. Não existe conteúdo digitado no banco.

Uso:
  python ai/anomaly_detector.py                  # processa e grava
  python ai/anomaly_detector.py --simular        # mostra o resultado sem gravar nada
  python ai/anomaly_detector.py --help           # todas as opções
"""

import argparse
import os
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from banco import conectar_banco


# =====================================================
# CONFIGURAÇÃO
# =====================================================

METRICAS = ("dwell_time", "flight_time", "mouse_speed")

NOMES_METRICAS = {
    "dwell_time": "tempo de pressão das teclas",
    "flight_time": "intervalo entre teclas",
    "mouse_speed": "velocidade do mouse",
}

# Fator que torna o MAD comparável ao desvio padrão em dados com distribuição normal
FATOR_MAD = 1.4826

# Escala mínima de cada métrica: 5% do baseline. Evita divisão por quase zero
# quando um colaborador é extremamente regular.
PISO_RELATIVO_ESCALA = 0.05

# NUMERIC(10,6) da coluna pontuacao_desvio
PONTUACAO_MAXIMA = 9999.999999


@dataclass(frozen=True)
class Config:
    janela_minutos: int = 15
    min_eventos_janela: int = 30
    min_historico: int = 200
    referencia_dias: int = 30
    baseline_validade_dias: int = 7
    proporcao_corte: float = 0.10
    limiar_baixo: float = 1.25
    limiar_medio: float = 1.75
    limiar_alto: float = 2.5
    limite_eventos: int = 100_000
    fuso_horario: str = "America/Sao_Paulo"


def ler_config(env=os.environ) -> Config:
    """Lê os parâmetros do ai/.env. Valores ausentes ou inválidos usam o padrão."""

    padrao = Config()
    valores = {}

    for campo, tipo in (
        ("janela_minutos", int),
        ("min_eventos_janela", int),
        ("min_historico", int),
        ("referencia_dias", int),
        ("baseline_validade_dias", int),
        ("limiar_baixo", float),
        ("limiar_medio", float),
        ("limiar_alto", float),
        ("limite_eventos", int),
    ):
        bruto = env.get(f"IA_{campo.upper()}")
        try:
            valor = tipo(bruto) if bruto else getattr(padrao, campo)
        except ValueError:
            valor = getattr(padrao, campo)
        valores[campo] = valor if valor > 0 else getattr(padrao, campo)

    valores["fuso_horario"] = env.get("IA_FUSO_HORARIO") or padrao.fuso_horario

    config = Config(**valores)

    if not config.limiar_baixo < config.limiar_medio < config.limiar_alto:
        raise ValueError("Os limiares devem respeitar IA_LIMIAR_BAIXO < IA_LIMIAR_MEDIO < IA_LIMIAR_ALTO.")

    return config


# =====================================================
# ESTATÍSTICA (funções puras, testadas sem banco)
# =====================================================

def media_aparada(valores, proporcao: float = 0.10) -> float:
    """
    Média dos valores entre os percentis `proporcao` e `1 - proporcao`.
    Descarta pausas longas e toques acidentais sem perder o sentido de "média".
    Usa a mesma regra do percentile_cont do PostgreSQL, para bater com o baseline.
    """

    dados = np.asarray(valores, dtype=float)
    inferior, superior = np.quantile(dados, [proporcao, 1 - proporcao])
    miolo = dados[(dados >= inferior) & (dados <= superior)]

    return float(miolo.mean())


def escala_robusta(mad: float, centro: float) -> float:
    """Converte o MAD em escala comparável ao desvio padrão, com piso de segurança."""

    return max(FATOR_MAD * float(mad), PISO_RELATIVO_ESCALA * abs(float(centro)), 1.0)


def pontuar_janela(eventos: pd.DataFrame, centro: dict, escala: dict, proporcao: float) -> dict:
    """
    Compara uma janela de eventos com o baseline.
    Devolve, por métrica, o valor da janela, a variação percentual e o z; e a pontuação final.
    """

    valores, variacoes, z = {}, {}, {}

    for metrica in METRICAS:
        valores[metrica] = media_aparada(eventos[metrica], proporcao)
        variacoes[metrica] = (valores[metrica] - centro[metrica]) / centro[metrica] if centro[metrica] else 0.0
        z[metrica] = (valores[metrica] - centro[metrica]) / escala[metrica]

    pontuacao = float(np.sqrt(np.mean([valor ** 2 for valor in z.values()])))

    return {
        "valores": valores,
        "variacoes": variacoes,
        "z": z,
        "pontuacao": min(round(pontuacao, 6), PONTUACAO_MAXIMA),
    }


def definir_nivel(pontuacao: float, config: Config):
    """None quando a janela está dentro do padrão do colaborador."""

    if pontuacao >= config.limiar_alto:
        return "ALTO"

    if pontuacao >= config.limiar_medio:
        return "MEDIO"

    if pontuacao >= config.limiar_baixo:
        return "BAIXO"

    return None


def criar_mensagem(nivel: str, resultado: dict, inicio: datetime, fim: datetime, fuso: ZoneInfo) -> str:
    """Mensagem do alerta para o RH: período e as duas métricas que mais mudaram."""

    principais = sorted(METRICAS, key=lambda metrica: abs(resultado["z"][metrica]), reverse=True)[:2]
    detalhes = ", ".join(
        f"{NOMES_METRICAS[metrica]} {resultado['variacoes'][metrica]:+.0%}"
        for metrica in principais
    )

    inicio_local = inicio.astimezone(fuso)
    fim_local = fim.astimezone(fuso)
    nivel_texto = "alto" if nivel == "ALTO" else "médio"

    mensagem = (
        f"Desvio {nivel_texto} em {inicio_local:%d/%m} das {inicio_local:%H:%M} às {fim_local:%H:%M}: "
        f"{detalhes} em relação ao padrão do colaborador. Recomenda-se acompanhamento."
    )

    return mensagem[:255]


def agrupar_em_janelas(eventos: pd.DataFrame, minutos: int) -> pd.DataFrame:
    """Acrescenta a coluna `janela` (início da janela, em UTC) a cada evento."""

    eventos = eventos.copy()
    eventos["data_coleta"] = pd.to_datetime(eventos["data_coleta"], utc=True)
    eventos["janela"] = eventos["data_coleta"].dt.floor(f"{minutos}min")

    return eventos


# =====================================================
# BANCO DE DADOS
# =====================================================

SQL_COLUNA_CONTROLE = """
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'telemetria'
      AND column_name = 'analisada_em';
"""

# FOR UPDATE SKIP LOCKED: duas execuções simultâneas nunca processam o mesmo evento
SQL_PENDENTES = """
    SELECT id, colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta
    FROM telemetria
    WHERE analisada_em IS NULL
      AND data_coleta < %(corte)s
    ORDER BY colaborador_id, data_coleta, id
    LIMIT %(limite)s
    FOR UPDATE SKIP LOCKED;
"""

SQL_BASELINES_ATUAIS = """
    SELECT DISTINCT ON (colaborador_id)
        id,
        colaborador_id,
        media_dwell_time::float8 AS dwell_time,
        media_flight_time::float8 AS flight_time,
        media_mouse_speed::float8 AS mouse_speed,
        EXTRACT(EPOCH FROM (LOCALTIMESTAMP - data_calculo)) / 86400 AS idade_dias
    FROM baseline
    WHERE colaborador_id = ANY(%(ids)s)
    ORDER BY colaborador_id, data_calculo DESC, id DESC;
"""

# Estatísticas do histórico já analisado, calculadas no próprio PostgreSQL para não
# trazer milhões de linhas para a memória: quantidade, média aparada (centro) e MAD.
SQL_ESTATISTICAS_HISTORICO = """
    WITH historico AS (
        SELECT colaborador_id, dwell_time, flight_time, mouse_speed
        FROM telemetria
        WHERE colaborador_id = ANY(%(ids)s)
          AND analisada_em IS NOT NULL
          AND data_coleta >= now() - make_interval(days => %(dias)s)
    ),
    quantis AS (
        SELECT
            colaborador_id,
            COUNT(*) AS n,
            percentile_cont(ARRAY[%(corte)s, 0.5, 1 - %(corte)s]) WITHIN GROUP (ORDER BY dwell_time) AS q_dwell,
            percentile_cont(ARRAY[%(corte)s, 0.5, 1 - %(corte)s]) WITHIN GROUP (ORDER BY flight_time) AS q_flight,
            percentile_cont(ARRAY[%(corte)s, 0.5, 1 - %(corte)s]) WITHIN GROUP (ORDER BY mouse_speed) AS q_mouse
        FROM historico
        GROUP BY colaborador_id
    )
    SELECT
        q.colaborador_id,
        q.n,
        AVG(h.dwell_time) FILTER (WHERE h.dwell_time BETWEEN q.q_dwell[1] AND q.q_dwell[3])::float8 AS centro_dwell_time,
        AVG(h.flight_time) FILTER (WHERE h.flight_time BETWEEN q.q_flight[1] AND q.q_flight[3])::float8 AS centro_flight_time,
        AVG(h.mouse_speed) FILTER (WHERE h.mouse_speed BETWEEN q.q_mouse[1] AND q.q_mouse[3])::float8 AS centro_mouse_speed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.dwell_time - q.q_dwell[2])) AS mad_dwell_time,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.flight_time - q.q_flight[2])) AS mad_flight_time,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.mouse_speed - q.q_mouse[2])) AS mad_mouse_speed
    FROM quantis q
    JOIN historico h USING (colaborador_id)
    GROUP BY q.colaborador_id, q.n;
"""

SQL_INSERIR_ANOMALIA = """
    INSERT INTO anomalia (colaborador_id, telemetria_id, baseline_id, nivel, pontuacao_desvio)
    VALUES (%s, %s, %s, %s, %s)
    RETURNING id;
"""

SQL_INSERIR_ALERTA = """
    INSERT INTO alerta (anomalia_id, status, mensagem)
    VALUES (%s, 'PENDENTE', %s)
    RETURNING id;
"""

SQL_MARCAR_ANALISADAS = """
    UPDATE telemetria
    SET analisada_em = now()
    WHERE id = ANY(%s);
"""

SQL_INSERIR_BASELINE = """
    INSERT INTO baseline (colaborador_id, media_dwell_time, media_flight_time, media_mouse_speed)
    VALUES (%s, %s, %s, %s)
    RETURNING id;
"""


def consultar(cursor, sql, parametros=None) -> list[dict]:
    cursor.execute(sql, parametros)
    colunas = [descricao.name for descricao in cursor.description]
    return [dict(zip(colunas, linha)) for linha in cursor.fetchall()]


def buscar_pendentes(cursor, corte: datetime, limite: int) -> pd.DataFrame:
    linhas = consultar(cursor, SQL_PENDENTES, {"corte": corte, "limite": limite})
    return pd.DataFrame(linhas, columns=["id", "colaborador_id", *METRICAS, "data_coleta"])


def buscar_baselines(cursor, ids: list[int]) -> dict:
    return {linha["colaborador_id"]: linha for linha in consultar(cursor, SQL_BASELINES_ATUAIS, {"ids": ids})}


def buscar_estatisticas(cursor, ids: list[int], config: Config) -> dict:
    parametros = {"ids": ids, "dias": config.referencia_dias, "corte": config.proporcao_corte}
    return {linha["colaborador_id"]: linha for linha in consultar(cursor, SQL_ESTATISTICAS_HISTORICO, parametros)}


# =====================================================
# PROCESSAMENTO
# =====================================================

@dataclass
class Resumo:
    eventos: int = 0
    janelas: int = 0
    calibracao: int = 0
    amostra_insuficiente: int = 0
    avaliadas: int = 0
    baixo: int = 0
    medio: int = 0
    alto: int = 0
    alertas: int = 0
    baselines: int = 0
    adiados: int = 0


def calcular_corte(agora: datetime, config: Config, incluir_janela_aberta: bool) -> datetime:
    """
    Só processa janelas já encerradas: a janela em andamento ainda vai receber eventos
    e seria avaliada pela metade. Com --incluir-janela-aberta, processa tudo.
    """

    if incluir_janela_aberta:
        return datetime.max.replace(tzinfo=timezone.utc)

    return pd.Timestamp(agora).floor(f"{config.janela_minutos}min").to_pydatetime()


def processar(conexao, config: Config, agora: datetime, incluir_janela_aberta=False, recalcular_baseline=False) -> Resumo:
    resumo = Resumo()
    fuso = ZoneInfo(config.fuso_horario)

    with conexao.cursor() as cursor:
        cursor.execute(SQL_COLUNA_CONTROLE)
        if cursor.fetchone() is None:
            raise RuntimeError(
                "A coluna telemetria.analisada_em não existe. Execute a migração: "
                "psql -U postgres -d <banco> -f database/migracoes/001_telemetria_analisada_em.sql"
            )

        corte = calcular_corte(agora, config, incluir_janela_aberta)
        pendentes = buscar_pendentes(cursor, corte, config.limite_eventos)
        resumo.eventos = len(pendentes)

        colaboradores = sorted(int(c) for c in pendentes["colaborador_id"].unique())

        if not pendentes.empty:
            eventos = agrupar_em_janelas(pendentes, config.janela_minutos)

            # Se a leitura parou no limite, a última janela pode estar incompleta: fica para a próxima execução
            if len(pendentes) == config.limite_eventos:
                ultimo = eventos.iloc[-1]
                incompleta = (eventos["colaborador_id"] == ultimo["colaborador_id"]) & (eventos["janela"] == ultimo["janela"])
                resumo.adiados = int(incompleta.sum())
                eventos = eventos[~incompleta]

            baselines = buscar_baselines(cursor, colaboradores)
            estatisticas = buscar_estatisticas(cursor, colaboradores, config)
            analisadas = []

            for (colaborador_id, inicio_janela), janela in eventos.groupby(["colaborador_id", "janela"], sort=True):
                colaborador_id = int(colaborador_id)
                resumo.janelas += 1
                analisadas.extend(int(i) for i in janela["id"])

                baseline = baselines.get(colaborador_id)
                historico = estatisticas.get(colaborador_id)

                # Sem baseline ou com pouco histórico, o padrão do colaborador ainda está sendo aprendido
                if baseline is None or historico is None or historico["n"] < config.min_historico:
                    resumo.calibracao += 1
                    continue

                if len(janela) < config.min_eventos_janela:
                    resumo.amostra_insuficiente += 1
                    continue

                resumo.avaliadas += 1
                centro = {metrica: baseline[metrica] for metrica in METRICAS}
                escala = {metrica: escala_robusta(historico[f"mad_{metrica}"], centro[metrica]) for metrica in METRICAS}
                resultado = pontuar_janela(janela, centro, escala, config.proporcao_corte)
                nivel = definir_nivel(resultado["pontuacao"], config)

                if nivel is None:
                    continue

                setattr(resumo, nivel.lower(), getattr(resumo, nivel.lower()) + 1)

                # A tabela anomalia exige uma telemetria: usamos o último evento da janela como referência
                telemetria_id = int(janela["id"].iloc[-1])
                cursor.execute(SQL_INSERIR_ANOMALIA, (colaborador_id, telemetria_id, baseline["id"], nivel, resultado["pontuacao"]))
                anomalia_id = cursor.fetchone()[0]

                fim_janela = inicio_janela + pd.Timedelta(minutes=config.janela_minutos)
                print(
                    f"  [{nivel:5}] colaborador {colaborador_id}, janela {inicio_janela.astimezone(fuso):%d/%m %H:%M}: "
                    f"pontuação {resultado['pontuacao']:.2f} "
                    f"(z dwell {resultado['z']['dwell_time']:+.2f}, flight {resultado['z']['flight_time']:+.2f}, "
                    f"mouse {resultado['z']['mouse_speed']:+.2f})"
                )

                if nivel in ("MEDIO", "ALTO"):
                    mensagem = criar_mensagem(nivel, resultado, inicio_janela.to_pydatetime(), fim_janela.to_pydatetime(), fuso)
                    cursor.execute(SQL_INSERIR_ALERTA, (anomalia_id, mensagem))
                    resumo.alertas += 1

            cursor.execute(SQL_MARCAR_ANALISADAS, (analisadas,))

        # Renova baselines ausentes ou vencidos com o histórico (já incluindo o que acabou de ser analisado)
        if colaboradores:
            resumo.baselines = atualizar_baselines(cursor, colaboradores, config, recalcular_baseline)

    return resumo


def atualizar_baselines(cursor, colaboradores: list[int], config: Config, forcar=False) -> int:
    """
    Cria uma NOVA linha de baseline (em vez de sobrescrever) para manter o histórico:
    cada anomalia continua apontando para o baseline com que foi comparada.
    """

    baselines = buscar_baselines(cursor, colaboradores)
    estatisticas = buscar_estatisticas(cursor, colaboradores, config)
    criados = 0

    for colaborador_id in colaboradores:
        historico = estatisticas.get(colaborador_id)
        baseline = baselines.get(colaborador_id)

        if historico is None or historico["n"] < config.min_historico:
            continue

        vencido = baseline is None or float(baseline["idade_dias"]) >= config.baseline_validade_dias

        if not (forcar or vencido):
            continue

        cursor.execute(
            SQL_INSERIR_BASELINE,
            (
                colaborador_id,
                round(historico["centro_dwell_time"], 2),
                round(historico["centro_flight_time"], 2),
                round(historico["centro_mouse_speed"], 2),
            ),
        )
        print(f"  Baseline {cursor.fetchone()[0]} criado para o colaborador {colaborador_id} ({historico['n']} eventos de histórico).")
        criados += 1

    return criados


def exibir_resumo(resumo: Resumo, simulacao: bool) -> None:
    print("\n=== RESUMO ===")
    print(f"Eventos lidos: {resumo.eventos}" + (f" ({resumo.adiados} adiados para a próxima execução)" if resumo.adiados else ""))
    print(f"Janelas: {resumo.janelas} | avaliadas: {resumo.avaliadas} | em calibração: {resumo.calibracao} "
          f"| amostra insuficiente: {resumo.amostra_insuficiente}")
    print(f"Anomalias: {resumo.baixo + resumo.medio + resumo.alto} "
          f"(BAIXO {resumo.baixo}, MEDIO {resumo.medio}, ALTO {resumo.alto})")
    print(f"Alertas criados: {resumo.alertas}")
    print(f"Baselines criados: {resumo.baselines}")

    if simulacao:
        print("\nSIMULAÇÃO: nenhuma alteração foi gravada no banco.")


# =====================================================
# EXECUÇÃO
# =====================================================

def ler_argumentos(argv=None):
    parser = argparse.ArgumentParser(description="Detecta anomalias comportamentais a partir da telemetria no PostgreSQL.")
    parser.add_argument("--simular", action="store_true", help="processa e mostra o resultado, mas desfaz tudo no final")
    parser.add_argument("--incluir-janela-aberta", action="store_true", help="processa também a janela de tempo em andamento")
    parser.add_argument("--recalcular-baseline", action="store_true", help="cria baselines novos mesmo que os atuais não estejam vencidos")
    parser.add_argument("--janela-minutos", type=int, help="sobrescreve IA_JANELA_MINUTOS")
    return parser.parse_args(argv)


def main(argv=None):
    # Consoles do Windows nem sempre usam UTF-8; sem isso os acentos saem quebrados
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    argumentos = ler_argumentos(argv)
    config = ler_config()

    if argumentos.janela_minutos:
        config = replace(config, janela_minutos=argumentos.janela_minutos)

    print("=== ECOS - Detecção de Anomalias (PostgreSQL) ===")
    print(f"Janelas de {config.janela_minutos} min | mínimo de {config.min_eventos_janela} eventos por janela "
          f"| limiares {config.limiar_baixo}/{config.limiar_medio}/{config.limiar_alto}\n")

    with conectar_banco() as conexao:
        try:
            resumo = processar(
                conexao,
                config,
                agora=datetime.now(timezone.utc),
                incluir_janela_aberta=argumentos.incluir_janela_aberta,
                recalcular_baseline=argumentos.recalcular_baseline,
            )
        except Exception:
            conexao.rollback()
            raise

        if argumentos.simular:
            conexao.rollback()
        else:
            conexao.commit()

    exibir_resumo(resumo, argumentos.simular)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        sys.exit(1)
