import os

import psycopg

from anomaly_detector import (
    ARQUIVO_TELEMETRIA,
    carregar_telemetria,
    validar_dados,
    detectar_anomalias,
    calcular_baseline,
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
    """
    Abre uma conexão com o PostgreSQL.
    """

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
# LOCALIZAR COLABORADOR
# =====================================================

def buscar_colaborador_id(conexao, codigo_anonimo):
    """
    Localiza o colaborador utilizando o userId anônimo
    recebido pela telemetria.
    """

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
# SALVAR BASELINE
# =====================================================

def salvar_baseline(
    conexao,
    colaborador_id,
    media_dwell_time,
    media_flight_time,
    media_mouse_speed,
):
    """
    Atualiza o baseline existente ou cria um novo
    caso o colaborador ainda não possua baseline.
    """

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

        baseline_existente = cursor.fetchone()

        if baseline_existente:

            baseline_id = baseline_existente[0]

            cursor.execute(
                """
                UPDATE baseline
                SET
                    media_dwell_time = %s,
                    media_flight_time = %s,
                    media_mouse_speed = %s,
                    data_calculo = CURRENT_TIMESTAMP
                WHERE id = %s;
                """,
                (
                    media_dwell_time,
                    media_flight_time,
                    media_mouse_speed,
                    baseline_id,
                ),
            )

            print(
                f"Baseline {baseline_id} atualizado "
                f"para colaborador {colaborador_id}."
            )

        else:

            cursor.execute(
                """
                INSERT INTO baseline (
                    colaborador_id,
                    media_dwell_time,
                    media_flight_time,
                    media_mouse_speed
                )
                VALUES (%s, %s, %s, %s)
                RETURNING id;
                """,
                (
                    colaborador_id,
                    media_dwell_time,
                    media_flight_time,
                    media_mouse_speed,
                ),
            )

            baseline_id = cursor.fetchone()[0]

            print(
                f"Baseline {baseline_id} criado "
                f"para colaborador {colaborador_id}."
            )

    return baseline_id


# =====================================================
# EXECUÇÃO
# =====================================================

def main():

    print("=== ECOS - Integração IA + PostgreSQL ===")

    # 1. Carrega o JSON
    dataframe = carregar_telemetria(
        ARQUIVO_TELEMETRIA
    )

    # 2. Valida estrutura
    validar_dados(dataframe)

    # 3. Detecta anomalias
    resultado = detectar_anomalias(
        dataframe
    )

    # 4. Calcula baseline somente com registros normais
    baseline = calcular_baseline(
        resultado
    )

    print(
        f"\nBaselines calculados: {len(baseline)}"
    )

    # 5. Conecta ao PostgreSQL
    with conectar_banco() as conexao:

        for _, linha in baseline.iterrows():

            codigo_anonimo = linha["userId"]

            colaborador_id = buscar_colaborador_id(
                conexao,
                codigo_anonimo,
            )

            salvar_baseline(
                conexao,
                colaborador_id,
                float(linha["media_dwell_time"]),
                float(linha["media_flight_time"]),
                float(linha["media_mouse_speed"]),
            )

        conexao.commit()

    print(
        "\nIntegração concluída com sucesso."
    )


if __name__ == "__main__":
    main()