import json
from pathlib import Path

import pandas as pd


ARQUIVO_TELEMETRIA = Path("telemetria-mock.json")

COLUNAS_ANALISE = [
    "dwellTime",
    "flightTime",
    "mouseSpeed",
]


def carregar_telemetria(caminho: Path) -> pd.DataFrame:
    if not caminho.exists():
        raise FileNotFoundError(
            f"Arquivo de telemetria não encontrado: {caminho}"
        )

    with open(caminho, "r", encoding="utf-8") as arquivo:
        dados = json.load(arquivo)

    return pd.DataFrame(dados)


def validar_dados(dataframe: pd.DataFrame) -> None:
    colunas_obrigatorias = [
        "userId",
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


def calcular_baseline(dataframe: pd.DataFrame) -> pd.DataFrame:
    """
    Calcula o baseline médio de cada colaborador.
    """

    baseline = (
        dataframe
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


def main():
    print("=== ECOS - Cálculo de Baseline ===")

    dataframe = carregar_telemetria(ARQUIVO_TELEMETRIA)

    validar_dados(dataframe)

    baseline = calcular_baseline(dataframe)

    print(f"\nTotal de colaboradores: {len(baseline)}")

    print("\nBaseline calculado:")

    print(baseline.to_string(index=False))


if __name__ == "__main__":
    main()