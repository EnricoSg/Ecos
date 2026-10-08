import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import IsolationForest


# =====================================================
# CONFIGURAÇÕES
# =====================================================

ARQUIVO_TELEMETRIA = Path("telemetria-mock.json")

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
    Classifica os registros utilizando Isolation Forest.
    """

    dados_modelo = dataframe[COLUNAS_ANALISE]

    modelo = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42,
    )

    dataframe = dataframe.copy()

    dataframe["resultado_modelo"] = modelo.fit_predict(
        dados_modelo
    )

    dataframe["classificacao"] = (
        dataframe["resultado_modelo"]
        .map({
            1: "NORMAL",
            -1: "ANOMALIA",
        })
    )

    dataframe["pontuacao_anomalia"] = (
        modelo.decision_function(dados_modelo)
    )

    return dataframe


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

    dataframe = carregar_telemetria(
        ARQUIVO_TELEMETRIA
    )

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