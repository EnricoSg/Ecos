"""
Conexão com o PostgreSQL do Ecos para os scripts de IA.

Mesma ordem de configuração dos módulos em Node (config/carregar-env.js);
a primeira fonte que definir a variável vence:
  1. variáveis do sistema
  2. ai/.env, se existir
  3. .env da raiz do projeto, se existir (ajustes desta máquina)
  4. config/desenvolvimento.env, só fora de produção (NODE_ENV diferente de "production")
"""

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv


PASTA_IA = Path(__file__).resolve().parent
RAIZ = PASTA_IA.parent


def carregar_configuracao() -> None:
    # override=False: nunca sobrescreve o que já foi definido por uma fonte de prioridade maior
    load_dotenv(PASTA_IA / ".env", override=False)
    load_dotenv(RAIZ / ".env", override=False)

    if os.getenv("NODE_ENV") != "production":
        load_dotenv(RAIZ / "config" / "desenvolvimento.env", override=False)


carregar_configuracao()


def conectar_banco() -> psycopg.Connection:
    senha = os.getenv("ECOS_DB_PASSWORD")

    if not senha:
        raise ValueError(
            "ECOS_DB_PASSWORD não está configurada. "
            "Rode \"npm run configurar\" na raiz do projeto para informar a senha do PostgreSQL."
        )

    return psycopg.connect(
        host=os.getenv("ECOS_DB_HOST", "localhost"),
        port=int(os.getenv("ECOS_DB_PORT", "5432")),
        dbname=os.getenv("ECOS_DB_NAME", "ecos_db"),
        user=os.getenv("ECOS_DB_USER", "postgres"),
        password=senha,
    )
