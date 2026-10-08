import os
from datetime import datetime, timezone

import psycopg

from anomaly_detector import (
    ARQUIVO_TELEMETRIA,
    carregar_telemetria,
    validar_dados,
    detectar_anomalias,
)


# =====================================================
# CONFIGURAÇÃO DO BANCO
# =====================================================

DB_HOST = "localhost"
DB_PORT = 5432
DB_NAME = os.getenv("ECOS_DB_NAME", "ecos_teste")
DB_USER = "postgres"
DB_PASSWORD = os.getenv("ECOS_DB_PASSWORD")


# =====================================================
# CONEXÃO
# =====================================================

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


# =====================================================
# CONVERSÃO DO TIMESTAMP
# =====================================================

def converter_timestamp(timestamp_ms):
    return datetime.fromtimestamp(
        timestamp_ms / 1000,
        tz=timezone.utc,
    )


# =====================================================
# BUSCAR COLABORADOR
# =====================================================

def buscar_colaborador_id(conexao, codigo_anonimo):
    with conexao.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM colaborador
            WHERE codigo_anonimo = %s;
            """,
            (codigo_anonimo,),
        )

        resultado = cursor.fetchone()

    if resultado is None:
        raise ValueError(
            f"Colaborador não encontrado: {codigo_anonimo}"
        )

    return resultado[0]


# =====================================================
# BUSCAR BASELINE
# =====================================================

def buscar_baseline_id(conexao, colaborador_id):
    with conexao.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM baseline
            WHERE colaborador_id = %s
            ORDER BY id
            LIMIT 1;
            """,
            (colaborador_id,),
        )

        resultado = cursor.fetchone()

    if resultado is None:
        raise ValueError(
            f"Baseline não encontrado para colaborador "
            f"{colaborador_id}"
        )

    return resultado[0]


# =====================================================
# LOCALIZAR TELEMETRIA
# =====================================================

def buscar_telemetria_id(
    conexao,
    colaborador_id,
    dwell_time,
    flight_time,
    mouse_speed,
    data_coleta,
):
    with conexao.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM telemetria
            WHERE colaborador_id = %s
              AND dwell_time = %s
              AND flight_time = %s
              AND mouse_speed = %s
              AND data_coleta = %s
            ORDER BY id
            LIMIT 1;
            """,
            (
                colaborador_id,
                dwell_time,
                flight_time,
                mouse_speed,
                data_coleta,
            ),
        )

        resultado = cursor.fetchone()

    if resultado is None:
        return None

    return resultado[0]


# =====================================================
# VERIFICAR DUPLICIDADE
# =====================================================

def anomalia_existe(conexao, telemetria_id):
    with conexao.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM anomalia
            WHERE telemetria_id = %s
            LIMIT 1;
            """,
            (telemetria_id,),
        )

        return cursor.fetchone() is not None


# =====================================================
# DEFINIR NÍVEL
# =====================================================

def definir_nivel(pontuacao):
    """
    Quanto mais negativa a pontuação do Isolation Forest,
    maior o desvio em relação ao padrão.

    Os limites abaixo são heurísticos para o MVP.
    """

    if pontuacao <= -0.05:
        return "ALTO"

    if pontuacao <= -0.02:
        return "MEDIO"

    return "BAIXO"


# =====================================================
# INSERIR ANOMALIA
# =====================================================

def inserir_anomalia(
    conexao,
    colaborador_id,
    telemetria_id,
    baseline_id,
    nivel,
    pontuacao,
):
    with conexao.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO anomalia (
                colaborador_id,
                telemetria_id,
                baseline_id,
                nivel,
                pontuacao_desvio
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (
                colaborador_id,
                telemetria_id,
                baseline_id,
                nivel,
                pontuacao,
            ),
        )

        return cursor.fetchone()[0]


# =====================================================
# EXECUÇÃO
# =====================================================

def main():
    print("=== ECOS - Persistência de Anomalias ===")

    dataframe = carregar_telemetria(
        ARQUIVO_TELEMETRIA
    )

    validar_dados(dataframe)

    resultado = detectar_anomalias(
        dataframe
    )

    anomalias = resultado[
        resultado["classificacao"] == "ANOMALIA"
    ]

    print(
        f"\nAnomalias detectadas pelo modelo: "
        f"{len(anomalias)}"
    )

    inseridas = 0
    ignoradas = 0
    nao_encontradas = 0

    with conectar_banco() as conexao:

        cache_colaboradores = {}
        cache_baselines = {}

        for _, linha in anomalias.iterrows():

            codigo_anonimo = linha["userId"]

            if codigo_anonimo not in cache_colaboradores:
                cache_colaboradores[codigo_anonimo] = (
                    buscar_colaborador_id(
                        conexao,
                        codigo_anonimo,
                    )
                )

            colaborador_id = cache_colaboradores[
                codigo_anonimo
            ]

            if colaborador_id not in cache_baselines:
                cache_baselines[colaborador_id] = (
                    buscar_baseline_id(
                        conexao,
                        colaborador_id,
                    )
                )

            baseline_id = cache_baselines[
                colaborador_id
            ]

            data_coleta = converter_timestamp(
                int(linha["timestamp"])
            )

            telemetria_id = buscar_telemetria_id(
                conexao,
                colaborador_id,
                int(linha["dwellTime"]),
                int(linha["flightTime"]),
                int(linha["mouseSpeed"]),
                data_coleta,
            )

            if telemetria_id is None:
                nao_encontradas += 1
                continue

            if anomalia_existe(
                conexao,
                telemetria_id,
            ):
                ignoradas += 1
                continue

            pontuacao = float(
                linha["pontuacao_anomalia"]
            )

            nivel = definir_nivel(
                pontuacao
            )

            inserir_anomalia(
                conexao,
                colaborador_id,
                telemetria_id,
                baseline_id,
                nivel,
                pontuacao,
            )

            inseridas += 1

        conexao.commit()

    print(f"\nAnomalias inseridas: {inseridas}")
    print(f"Anomalias ignoradas: {ignoradas}")
    print(
        f"Telemetrias não encontradas: "
        f"{nao_encontradas}"
    )

    print(
        "\nPersistência de anomalias concluída."
    )


if __name__ == "__main__":
    main()