"""
ECOS - Pipeline da IA

Executa o motor de anomalias sobre a telemetria pendente no PostgreSQL.
Um único passo faz tudo em uma transação: detecção, anomalias, alertas e
renovação dos baselines. Pode ser agendado (ex.: Agendador de Tarefas do
Windows ou cron) para rodar a cada 15 minutos, o mesmo tamanho da janela.

Uso: python ai/pipeline.py [--simular] [demais opções do anomaly_detector]
"""

import sys

import anomaly_detector


if __name__ == "__main__":
    try:
        anomaly_detector.main(sys.argv[1:])
    except (RuntimeError, ValueError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        sys.exit(1)
