import os

import psycopg


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


def buscar_anomalias_sem_alerta(conexao):
    """
    Retorna anomalias MEDIO ou ALTO que ainda
    não possuem alerta associado.
    """

    with conexao.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                a.id,
                a.nivel,
                a.pontuacao_desvio
            FROM anomalia a
            LEFT JOIN alerta al
                ON al.anomalia_id = a.id
            WHERE al.id IS NULL
              AND a.nivel IN ('MEDIO', 'ALTO')
            ORDER BY a.id;
            """
        )

        return cursor.fetchall()


def criar_mensagem(nivel):
    if nivel == "ALTO":
        return (
            "Desvio comportamental de nível alto "
            "detectado. Recomenda-se acompanhamento."
        )

    return (
        "Desvio comportamental de nível médio "
        "detectado. Recomenda-se acompanhamento."
    )


def inserir_alerta(
    conexao,
    anomalia_id,
    nivel,
):
    mensagem = criar_mensagem(nivel)

    with conexao.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO alerta (
                anomalia_id,
                status,
                mensagem
            )
            VALUES (%s, 'PENDENTE', %s)
            RETURNING id;
            """,
            (
                anomalia_id,
                mensagem,
            ),
        )

        return cursor.fetchone()[0]


def main():
    print("=== ECOS - Geração de Alertas ===")

    with conectar_banco() as conexao:

        anomalias = buscar_anomalias_sem_alerta(
            conexao
        )

        print(
            f"\nAnomalias elegíveis para alerta: "
            f"{len(anomalias)}"
        )

        alertas_criados = 0

        for (
            anomalia_id,
            nivel,
            pontuacao,
        ) in anomalias:

            alerta_id = inserir_alerta(
                conexao,
                anomalia_id,
                nivel,
            )

            print(
                f"Alerta {alerta_id} criado "
                f"para anomalia {anomalia_id} "
                f"({nivel})."
            )

            alertas_criados += 1

        conexao.commit()

    print(
        f"\nAlertas criados: {alertas_criados}"
    )

    print(
        "\nGeração de alertas concluída."
    )


if __name__ == "__main__":
    main()