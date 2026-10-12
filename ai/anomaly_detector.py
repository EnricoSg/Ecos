import os
import psycopg
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import IsolationForest


# =====================================================
# CONFIGURAÇÕES
# =====================================================

ARQUIVO_TELEMETRIA = Path("telemetria-mock.json")

DB_HOST = "localhost"
DB_PORT = 5432
DB_NAME = os.getenv("ECOS_DB_NAME", "ecos_teste")
DB_USER = "postgres"
DB_PASSWORD = os.getenv("ECOS_DB_PASSWORD")

COLUNAS_ANALISE = [
    "dwellTime",
    "flightTime",
    "mouseSpeed",
]


# =====================================================
# CARREGAMENTO DOS DADOS
# =====================================================

def carregar_telemetria(caminho: Path) -> pd.DataFrame:
    """
    Carrega o arquivo JSON de telemetria.
    """

    if not caminho.exists():
        raise FileNotFoundError(
            f"Arquivo de telemetria não encontrado: {caminho}"
        )

    with open(caminho, "r", encoding="utf-8") as arquivo:
        dados = json.load(arquivo)

    return pd.DataFrame(dados)

def conectar_banco():
    if not DB_PASSWORD:
        raise ValueError(
            "A variável ECOS_DB_PASSWORD não foi configurada."
        )

    return psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def carregar_telemetria_banco() -> pd.DataFrame:
    """
    Carrega as telemetrias diretamente do PostgreSQL.
    """

    consulta = """
        SELECT
            c.codigo_anonimo AS "userId",
            EXTRACT(EPOCH FROM t.data_coleta) * 1000 AS "timestamp",
            t.dwell_time AS "dwellTime",
            t.flight_time AS "flightTime",
            t.mouse_speed AS "mouseSpeed"
        FROM telemetria t
        JOIN colaborador c
            ON c.id = t.colaborador_id
        ORDER BY t.data_coleta;
    """

    with conectar_banco() as conexao:
        with conexao.cursor() as cursor:
            cursor.execute(consulta)

            colunas = [
                descricao.name
                for descricao in cursor.description
            ]

            registros = cursor.fetchall()

    return pd.DataFrame(
        registros,
        columns=colunas
    )

# =====================================================
# VALIDAÇÃO
# =====================================================

def validar_dados(dataframe: pd.DataFrame) -> None:
    """
    Verifica se todas as colunas necessárias existem.
    """

    colunas_obrigatorias = [
        "userId",
        "timestamp",
        *COLUNAS_ANALISE,
    ]

    colunas_ausentes = [
        coluna
        for coluna in colunas_obrigatorias
        if coluna not in dataframe.columns
    ]

    if colunas_ausentes:
        raise ValueError(
            f"Colunas obrigatórias ausentes: {colunas_ausentes}"
        )


# =====================================================
# DETECÇÃO DE ANOMALIAS
# =====================================================

def detectar_anomalias(dataframe: pd.DataFrame) -> pd.DataFrame:
    """
    Executa a detecção de anomalias separadamente
    para cada colaborador.

    Cada userId possui seu próprio modelo comportamental.
    """

    resultados = []

    for user_id, grupo in dataframe.groupby("userId"):

        grupo = grupo.copy()

        print(
            f"Analisando colaborador {user_id}: "
            f"{len(grupo)} registros"
        )

        # Evita treinar Isolation Forest com poucos dados.
        if len(grupo) < 10:

            grupo["resultado_modelo"] = 1
            grupo["classificacao"] = "NORMAL"
            grupo["pontuacao_anomalia"] = 0.0

            print(
                "  Poucos registros para treinamento. "
                "Classificados temporariamente como NORMAL."
            )

            resultados.append(grupo)

            continue

        dados_modelo = grupo[COLUNAS_ANALISE]

        modelo = IsolationForest(
            n_estimators=100,
            contamination=0.05,
            random_state=42,
        )

        grupo["resultado_modelo"] = modelo.fit_predict(
            dados_modelo
        )

        grupo["classificacao"] = (
            grupo["resultado_modelo"]
            .map({
                1: "NORMAL",
                -1: "ANOMALIA",
            })
        )

        grupo["pontuacao_anomalia"] = (
            modelo.decision_function(
                dados_modelo
            )
        )

        resultados.append(grupo)

    resultado_final = pd.concat(
        resultados,
        ignore_index=True
    )

    return resultado_final


# =====================================================
# BASELINE
# =====================================================

def calcular_baseline(dataframe: pd.DataFrame) -> pd.DataFrame:
    """
    Calcula o baseline apenas com registros classificados
    como NORMAL.
    """

    registros_normais = dataframe[
        dataframe["classificacao"] == "NORMAL"
    ]

    baseline = (
        registros_normais
        .groupby("userId")[COLUNAS_ANALISE]
        .mean()
        .reset_index()
    )

    baseline = baseline.rename(
        columns={
            "dwellTime": "media_dwell_time",
            "flightTime": "media_flight_time",
            "mouseSpeed": "media_mouse_speed",
        }
    )

    return baseline


# =====================================================
# RESUMO
# =====================================================

def exibir_resumo(
    resultado: pd.DataFrame,
    baseline: pd.DataFrame
) -> None:

    total = len(resultado)

    normais = (
        resultado["classificacao"] == "NORMAL"
    ).sum()

    anomalias = (
        resultado["classificacao"] == "ANOMALIA"
    ).sum()

    print("\n=== RESULTADO DA ANÁLISE ===")

    print(f"\nTotal de registros: {total}")
    print(f"Registros normais: {normais}")
    print(f"Anomalias detectadas: {anomalias}")

    print("\n=== BASELINE ===")

    print(
        baseline.to_string(index=False)
    )

    print("\n=== EXEMPLOS DE ANOMALIAS ===")

    colunas_saida = [
        "userId",
        "timestamp",
        "dwellTime",
        "flightTime",
        "mouseSpeed",
        "pontuacao_anomalia",
    ]

    print(
        resultado[
            resultado["classificacao"] == "ANOMALIA"
        ][colunas_saida]
        .head(10)
        .to_string(index=False)
    )


# =====================================================
# EXECUÇÃO
# =====================================================

def main():

    print(
        "=== ECOS - Detecção de Anomalias e Baseline ==="
    )

    dataframe = carregar_telemetria_banco()

    validar_dados(dataframe)

    resultado = detectar_anomalias(
        dataframe
    )

    baseline = calcular_baseline(
        resultado
    )

    exibir_resumo(
        resultado,
        baseline
    )


if __name__ == "__main__":
    main()