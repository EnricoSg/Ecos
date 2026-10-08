# Módulo de IA — Ecos

Este diretório contém os scripts responsáveis pelo processamento das telemetrias comportamentais, cálculo de baseline, detecção de anomalias e geração de alertas do projeto **Ecos — Assinatura Digital Comportamental Corporativa**.

## Objetivo

O módulo analisa metadados comportamentais anonimizados coletados durante a interação com o computador.

São utilizadas as seguintes métricas:

- `dwellTime`: tempo em que a tecla permanece pressionada
- `flightTime`: intervalo entre eventos de digitação
- `mouseSpeed`: velocidade do movimento do cursor

O sistema não utiliza conteúdo digitado nem identificação literal das teclas pressionadas.

## Tecnologias

- Python
- pandas
- NumPy
- scikit-learn
- psycopg
- PostgreSQL

## Estrutura

### `anomaly_detector.py`

Responsável por:

- carregar o arquivo de telemetria
- validar os campos necessários
- executar o algoritmo Isolation Forest
- classificar os registros como `NORMAL` ou `ANOMALIA`
- calcular a pontuação de anomalia
- calcular o baseline utilizando apenas registros classificados como normais

O modelo está configurado inicialmente com:

```python
IsolationForest(
    n_estimators=100,
    contamination=0.05,
    random_state=42
)