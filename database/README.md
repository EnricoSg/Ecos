# Banco de Dados — Ecos

Este diretório contém os scripts necessários para criar e popular o banco de dados PostgreSQL do projeto **Ecos — Assinatura Digital Comportamental Corporativa**.

O banco armazena dados comportamentais anonimizados utilizados pelo sistema para estabelecer padrões de comportamento (baseline), registrar telemetrias, identificar possíveis anomalias e gerar alertas.

## Tecnologias

- PostgreSQL
- pgAdmin 4
- SQL

## Estrutura

O banco de dados é composto pelas seguintes tabelas:

### `colaborador`

Representa os colaboradores monitorados pelo sistema utilizando identificadores anônimos.

Principais informações armazenadas:

- Código anônimo
- Setor
- Data de cadastro
- Status do colaborador

O campo `codigo_anonimo` é utilizado para relacionar o identificador anônimo recebido pelo sistema com o identificador interno do colaborador no banco.

### `telemetria`

Armazena as métricas comportamentais coletadas durante a utilização do computador.

As métricas armazenadas são:

- `dwell_time` — tempo que uma tecla permanece pressionada, em milissegundos
- `flight_time` — intervalo entre eventos de digitação, em milissegundos
- `mouse_speed` — velocidade do movimento do cursor
- `data_coleta` — data e horário em que a telemetria foi coletada

Cada telemetria é associada a um colaborador por meio de uma chave estrangeira (`colaborador_id`).

O sistema não armazena qual tecla foi pressionada nem o conteúdo digitado pelo colaborador.

### `baseline`

Armazena o padrão comportamental de referência de cada colaborador.

Atualmente são armazenadas as médias das seguintes métricas:

- `media_dwell_time`
- `media_flight_time`
- `media_mouse_speed`

Esse padrão pode ser utilizado para comparar novas telemetrias e identificar alterações significativas no comportamento.

### `anomalia`

Registra telemetrias que apresentaram desvios em relação ao baseline do colaborador.

A anomalia relaciona:

- Colaborador
- Telemetria
- Baseline
- Nível do desvio
- Pontuação do desvio
- Data da detecção

Os níveis atualmente previstos são:

- `BAIXO`
- `MEDIO`
- `ALTO`

### `alerta`

Armazena os alertas gerados a partir das anomalias detectadas.

Cada alerta está associado a uma anomalia e pode possuir os estados:

- `PENDENTE`
- `RESOLVIDO`

Os alertas poderão ser utilizados pelo sistema e pelo dashboard destinado aos profissionais responsáveis pelo acompanhamento.

## Integração com a Telemetria

Os dados coletados pelo módulo de telemetria chegam no seguinte formato:

```json
{
  "userId": "a2a0159acf6ac55f05c0c4d4bdc54004",
  "timestamp": 1790723199823,
  "dwellTime": 103,
  "flightTime": 68,
  "mouseSpeed": 476
}
```

A correspondência entre os dados recebidos e o banco é:

| Telemetria recebida | Banco de dados |
|---|---|
| `userId` | `colaborador.codigo_anonimo` |
| `timestamp` | `telemetria.data_coleta` |
| `dwellTime` | `telemetria.dwell_time` |
| `flightTime` | `telemetria.flight_time` |
| `mouseSpeed` | `telemetria.mouse_speed` |

O `userId` não é repetido diretamente na tabela `telemetria`. O sistema utiliza o identificador anônimo para localizar o colaborador e relaciona a telemetria através de `colaborador_id`.

O `timestamp` recebido pelo coletor utiliza Unix timestamp em milissegundos e deve ser convertido para `TIMESTAMPTZ` antes ou durante a persistência no PostgreSQL.

## Relacionamentos

Os principais relacionamentos do banco são:

```text
colaborador
    │
    ├── 1:N ── telemetria
    │
    └─────── baseline
                 │
telemetria ──────┼── anomalia
colaborador ─────┘       │
                         │
                         └── alerta
```

As chaves estrangeiras garantem a integridade dos relacionamentos entre as tabelas.

## Arquivos

### `schema.sql`

Contém a estrutura do banco de dados, incluindo:

- Tabelas
- Chaves primárias
- Chaves estrangeiras
- Constraints
- Índices
- Relacionamentos

Este arquivo deve ser executado primeiro.

### `seed.sql`

Contém dados utilizados para testes e desenvolvimento.

O arquivo inclui exemplos de:

- Colaboradores anônimos
- Telemetrias comportamentais
- Baselines
- Telemetrias anômalas
- Anomalias
- Alertas

Os registros adicionais presentes no arquivo são dados simulados utilizados para desenvolvimento e validação do banco.

## Como configurar o banco

### 1. Criar um banco PostgreSQL

Crie um banco vazio no PostgreSQL.

Exemplo:

```text
ecos
```

O nome pode ser alterado de acordo com o ambiente de desenvolvimento.

### 2. Executar o `schema.sql`

Conecte-se ao banco criado e execute:

```text
database/schema.sql
```

Esse script criará toda a estrutura necessária.

### 3. Executar o `seed.sql`

Após a criação da estrutura, execute:

```text
database/seed.sql
```

O script adicionará os dados utilizados nos testes.

A ordem de execução deve ser:

```text
schema.sql
    ↓
seed.sql
```

## Validação

Após executar os dois arquivos, o banco deve possuir as seguintes tabelas:

```text
colaborador
telemetria
baseline
anomalia
alerta
```

Com o conjunto atual de dados de teste, são esperados:

| Tabela | Registros |
|---|---:|
| colaborador | 3 |
| telemetria | 11 |
| baseline | 3 |
| anomalia | 2 |
| alerta | 2 |

Para validar os registros:

```sql
SET search_path TO public;

SELECT 'colaborador' AS tabela, COUNT(*) AS registros FROM colaborador
UNION ALL
SELECT 'telemetria', COUNT(*) FROM telemetria
UNION ALL
SELECT 'baseline', COUNT(*) FROM baseline
UNION ALL
SELECT 'anomalia', COUNT(*) FROM anomalia
UNION ALL
SELECT 'alerta', COUNT(*) FROM alerta;
```

Para validar as telemetrias e seus respectivos colaboradores:

```sql
SELECT
    t.id,
    c.codigo_anonimo,
    t.dwell_time,
    t.flight_time,
    t.mouse_speed,
    t.data_coleta
FROM telemetria t
JOIN colaborador c
    ON c.id = t.colaborador_id
ORDER BY t.id;
```

## Privacidade e Segurança

O projeto foi estruturado para trabalhar com dados comportamentais anonimizados.

O banco não deve armazenar:

- Conteúdo digitado pelo colaborador
- Teclas pressionadas
- Senhas digitadas
- Mensagens
- Documentos acessados
- Conteúdo da tela

O objetivo é trabalhar somente com métricas comportamentais necessárias ao funcionamento do sistema, como tempo de pressionamento das teclas, intervalos entre eventos de digitação e movimentação do mouse.

A identificação utilizada na telemetria é anônima e não deve expor diretamente a identidade do colaborador.