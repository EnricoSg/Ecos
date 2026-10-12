import subprocess
import sys


SCRIPTS = [
    "ai/database_integration.py",
    "ai/save_anomalies.py",
    "ai/save_alerts.py",
]


def executar_script(caminho):
    print(f"\n=== Executando {caminho} ===")

    resultado = subprocess.run(
        [sys.executable, caminho],
        check=False,
    )

    if resultado.returncode != 0:
        raise RuntimeError(
            f"Falha ao executar {caminho}"
        )


def main():
    print("=== ECOS - Pipeline da IA ===")

    for script in SCRIPTS:
        executar_script(script)

    print(
        "\n=== Pipeline concluído com sucesso ==="
    )


if __name__ == "__main__":
    main()