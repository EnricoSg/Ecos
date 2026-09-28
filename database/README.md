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

Exemplos de informações armazenadas:

- Código anônimo
- Setor

### `telemetria`

Armazena as métricas comportamentais coletadas durante a utilização do computador.

Entre as métricas utilizadas estão:

- Velocidade de digitação
- Tempo médio de pausa
- Velocidade do mouse
- Data da coleta

O sistema não armazena o conteúdo digitado pelo colaborador.

### `baseline`

Armazena o padrão comportamental de referência de cada colaborador.

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

### `alerta`

Armazena os alertas gerados a partir das anomalias detectadas.

Os alertas podem ser utilizados posteriormente pelo sistema e pelo dashboard destinado aos profissionais responsáveis pelo acompanhamento.

## Arquivos

### `schema.sql`

Contém a estrutura do banco de dados, incluindo:

- Tabelas
- Chaves primárias
- Chaves estrangeiras
- Constraints
- Sequências
- Relacionamentos

Este arquivo deve ser executado primeiro.

### `seed.sql`

Contém dados fictícios utilizados para testes e desenvolvimento.

O arquivo inclui exemplos de:

- Colaboradores anônimos
- Telemetrias comportamentais
- Baselines
- Telemetrias anômalas
- Anomalias
- Alertas

Nenhum dos dados presentes neste arquivo representa colaboradores reais.

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

O script adicionará os dados fictícios utilizados nos testes.

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

## Privacidade e Segurança

O projeto foi estruturado para trabalhar com dados comportamentais anonimizados.

O banco não deve armazenar:

- Conteúdo digitado pelo colaborador
- Senhas digitadas
- Mensagens
- Documentos acessados
- Conteúdo da tela

O objetivo é trabalhar somente com métricas comportamentais necessárias ao funcionamento do sistema, como ritmo de digitação, pausas e movimentação do mouse.