"""
Conexão com o PostgreSQL do Ecos para os scripts de IA.

As credenciais vêm de ai/.env (copie ai/.env.example). Variáveis já definidas
no sistema têm prioridade sobre o arquivo. Os nomes são os mesmos usados pela API
(api/.env), então os dois módulos podem apontar para o mesmo banco sem conversão.
"""

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv


PASTA_IA = Path(__file__).resolve().parent

load_dotenv(PASTA_IA / ".env")


def conectar_banco() -> psycopg.Connection:
    senha = os.getenv("ECOS_DB_PASSWORD")

    if not senha:
        raise ValueError(
            "ECOS_DB_PASSWORD não está configurada. "
            "Copie ai/.env.example para ai/.env e preencha a senha."
        )

    return psycopg.connect(
        host=os.getenv("ECOS_DB_HOST", "localhost"),
        port=int(os.getenv("ECOS_DB_PORT", "5432")),
        dbname=os.getenv("ECOS_DB_NAME", "ecos_teste"),
        user=os.getenv("ECOS_DB_USER", "postgres"),
        password=senha,
    )
