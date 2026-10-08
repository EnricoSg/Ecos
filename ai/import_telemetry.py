import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg


ARQUIVO_TELEMETRIA = Path("telemetria-mock.json")

DB_HOST = "localhost"
DB_PORT = 5432
DB_NAME = os.getenv("ECOS_DB_NAME", "ecos_teste")
DB_USER = "postgres"
DB_PASSWORD = os.getenv("ECOS_DB_PASSWORD")


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


def carregar_json():
    if not ARQUIVO_TELEMETRIA.exists():
        raise FileNotFoundError(
            f"Arquivo não encontrado: {ARQUIVO_TELEMETRIA}"
        )

    with open(
        ARQUIVO_TELEMETRIA,
        "r",
        encoding="utf-8",
    ) as arquivo:
        return json.load(arquivo)


def converter_timestamp(timestamp_ms):
    """
    Converte Unix timestamp em milissegundos
    para datetime com timezone UTC.
    """

    return datetime.fromtimestamp(
        timestamp_ms / 1000,
        tz=timezone.utc,
    )


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


def telemetria_existe(
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

        return cursor.fetchone() is not None


def inserir_telemetria(
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
            INSERT INTO telemetria (
                colaborador_id,
                dwell_time,
                flight_time,
                mouse_speed,
                data_coleta
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (
                colaborador_id,
                dwell_time,
                flight_time,
                mouse_speed,
                data_coleta,
            ),
        )

        return cursor.fetchone()[0]


def main():
    print("=== ECOS - Importação de Telemetria ===")

    dados = carregar_json()

    inseridos = 0
    ignorados = 0

    with conectar_banco() as conexao:

        cache_colaboradores = {}

        for registro in dados:

            codigo_anonimo = registro["userId"]

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

            dwell_time = registro["dwellTime"]
            flight_time = registro["flightTime"]
            mouse_speed = registro["mouseSpeed"]

            data_coleta = converter_timestamp(
                registro["timestamp"]
            )

            if telemetria_existe(
                conexao,
                colaborador_id,
                dwell_time,
                flight_time,
                mouse_speed,
                data_coleta,
            ):
                ignorados += 1
                continue

            inserir_telemetria(
                conexao,
                colaborador_id,
                dwell_time,
                flight_time,
                mouse_speed,
                data_coleta,
            )

            inseridos += 1

        conexao.commit()

    print(f"\nRegistros inseridos: {inseridos}")
    print(f"Registros ignorados: {ignorados}")
    print("\nImportação concluída com sucesso.")


if __name__ == "__main__":
    main()