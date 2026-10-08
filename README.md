# Ecos — Assinatura Digital Comportamental Corporativa

> MVP para identificação precoce de sinais de **fadiga, estresse e burnout** a partir de mudanças no padrão de interação do colaborador com o computador (teclado e mouse), sem jamais registrar o que é digitado.

![Node.js](https://img.shields.io/badge/Node.js-tratamento-339933)
![Python](https://img.shields.io/badge/Python-IA-3776AB)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-banco%20de%20dados-336791)
![React](https://img.shields.io/badge/React-dashboard-61DAFB)
![ODS 3](https://img.shields.io/badge/ODS-3%20Sa%C3%BAde%20e%20Bem--Estar-4C9F38)

---

## Para que serve (RH e Psicologia Organizacional)

O burnout raramente aparece de um dia para o outro. Antes do afastamento, costuma haver sinais sutis: o ritmo de digitação desacelera, as pausas entre teclas ficam mais longas, o mouse se move de forma mais lenta e irregular. Esses sinais são invisíveis numa pesquisa de clima trimestral, mas aparecem nos **metadados de interação** do dia a dia.

O Ecos aprende o padrão comportamental normal de cada colaborador (a sua *assinatura digital*) e avisa quando há um desvio persistente em relação a esse padrão. Assim, o RH e a Psicologia Organizacional conseguem:

- **Agir de forma preventiva**, antes de um afastamento, com uma conversa, um ajuste de carga ou um encaminhamento.
- **Ver tendências por setor** e identificar equipes sob pressão contínua.
- **Apoiar decisões de saúde ocupacional** com indicadores objetivos, como complemento (nunca substituto) da avaliação profissional.

O projeto se alinha ao **ODS 3 — Saúde e Bem-Estar** da ONU e ao pilar **Social** das práticas **ESG**.

> **Importante:** O Ecos é uma ferramenta de **apoio ao cuidado**, não de vigilância ou avaliação de desempenho. Um alerta indica um desvio estatístico do colaborador em relação ao seu próprio padrão, nunca um diagnóstico clínico.

## Regra de Ouro: Privacidade e LGPD

A coleta é restrita **exclusivamente a metadados matemáticos de interação**. Estão fora do escopo do projeto, sem exceções:

| ❌ Nunca é coletado | ✅ O que é coletado |
|---|---|
| Conteúdo digitado (keylogging de texto) | Tempo de pressão de tecla (*dwell time*, ms) |
| Senhas, mensagens, documentos | Intervalo entre teclas (*flight time*, ms) |
| Capturas ou monitoramento de tela | Velocidade do mouse (px/s) |
| Reconhecimento facial / webcam | Carimbo temporal do evento |
| Nome, e-mail ou identidade real | Hash anônimo do colaborador |

Essa regra é aplicada no código, não só na política: o módulo [`src/validador.js`](src/validador.js) rejeita qualquer pacote que contenha campos fora de uma lista branca, e a suíte em [`tests/`](tests/) garante esse comportamento. Detalhes em [`docs/README_TRATAMENTO.md`](docs/README_TRATAMENTO.md).

## Arquitetura

O sistema é dividido em três grandes módulos, ligados por uma camada de tratamento de dados e pelo banco PostgreSQL:

```text
 ┌──────────────────────────┐
 │ 1. MÓDULO COLETOR        │  Estação de trabalho do colaborador
 │    (background)          │  Captura apenas tempos e velocidades
 └────────────┬─────────────┘  Pseudonimiza o ID com hash
              │ { userId, timestamp, dwellTime, flightTime, mouseSpeed }
              ▼
 ┌──────────────────────────┐
 │ Tratamento de telemetria │  src/validador.js
 │ (filtro de segurança)    │  Bloqueia texto/keylogging, valida e normaliza
 └────────────┬─────────────┘
              ▼
 ┌──────────────────────────┐
 │ PostgreSQL               │  database/
 │ colaborador · telemetria │  baseline · anomalia · alerta
 └──────┬────────────▲──────┘
        │            │ baselines, anomalias e alertas
        ▼            │
 ┌──────────────────────────┐
 │ 2. MOTOR ANALÍTICO (IA)  │  ai/
 │                          │  Isolation Forest + baseline individual
 └──────────────────────────┘
        │
        ▼  via API (backend)
 ┌──────────────────────────┐
 │ 3. INTERFACE WEB         │  frontend/
 │    (Dashboard RH)        │  Alertas e tendências, sem dados brutos
 └──────────────────────────┘
```

### 1. Módulo coletor (background)
Agente leve executado em segundo plano na estação de trabalho. Mede apenas **quando** as teclas são pressionadas e soltas e **com que velocidade** o mouse se move, nunca **quais** teclas. O identificador do colaborador sai da máquina já como hash anônimo. No MVP, o coletor é simulado pelo arquivo [`telemetria-mock.json`](telemetria-mock.json) (1000 eventos normais + 200 de fadiga).

### 2. Motor analítico
Scripts Python em [`ai/`](ai/) que classificam cada evento com **Isolation Forest** (algoritmo não supervisionado, que não precisa de dados rotulados de burnout), calculam o **baseline** de cada colaborador apenas com os eventos normais, gravam as anomalias com nível `BAIXO`, `MEDIO` ou `ALTO` e geram alertas para os níveis médio e alto.

### 3. Interface web
Dashboard em [`frontend/`](frontend/) (React + TypeScript + Vite + Tailwind) para profissionais de RH e Psicologia Organizacional. Mostra alertas e tendências agregadas, sem expor dados brutos de interação.

## Estrutura do repositório

```text
Ecos/
├── ai/                    # Motor analítico em Python (Lucas de Moura)
├── database/              # Schema e seed PostgreSQL (Enrico)
├── frontend/              # Dashboard RH em React (Marcelo)
├── src/
│   └── validador.js       # Filtro de segurança da telemetria (Lucas Coussirat)
├── tests/
│   └── validador.test.js  # Testes de anonimização / anti-keylogging (Jest)
├── docs/
│   └── README_TRATAMENTO.md  # Documentação técnica do tratamento de dados
├── telemetria-mock.json   # Telemetria simulada (entrada do validador e da IA)
├── package.json           # Projeto Node.js da raiz (validador + testes)
└── README.md
```

Cada módulo tem o seu próprio README com detalhes: [`ai/README.md`](ai/README.md), [`database/README.md`](database/README.md), [`frontend/README.md`](frontend/README.md).

## Como executar

**Pré-requisitos:** Node.js 18+, Python 3.10+ e PostgreSQL.

```bash
# Validador + testes (raiz)
npm install
npm test

# Dashboard RH
cd frontend
npm install
npm run dev            # http://localhost:5173

# Motor analítico (a partir da raiz, onde está o telemetria-mock.json)
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r ai/requirements.txt
python ai/anomaly_detector.py
```

Os scripts da IA que acessam o banco exigem a variável `ECOS_DB_PASSWORD` (e, opcionalmente, `ECOS_DB_NAME`). Veja [`database/README.md`](database/README.md) para criar o banco.

## Equipe

| Integrante | Papel | Responsabilidades |
|---|---|---|
| **Davy** | Scrum Master · QA · Auditoria Ética | Gerenciamento do projeto, qualidade e auditoria de conformidade com a LGPD |
| **Lucas Coussirat** | Engenharia de Dados | Tratamento e validação da telemetria; suporte na modelagem de IA |
| **Lucas de Moura** | Engenharia de IA | Treinamento do modelo preditivo e algoritmos (Isolation Forest) |
| **Gustavo** | Backend | API e integração entre os módulos |
| **Marcelo** | Frontend | UX/UI do Dashboard para RH |
| **Enrico** | Arquitetura · Segurança · Banco de Dados | Arquitetura do sistema, segurança e banco PostgreSQL |

## Estado atual do MVP

| Componente | Estado |
|---|---|
| Banco de dados (schema + seed) | ✅ `database/` |
| Telemetria simulada | ✅ `telemetria-mock.json` |
| Validador / filtro LGPD + testes | ✅ `src/` e `tests/` |
| Motor analítico (Isolation Forest, baseline, anomalias, alertas) | ✅ `ai/` |
| Dashboard RH | 🟡 Estrutura inicial em `frontend/` |
| API backend | 🔲 Planejado |
| Módulo coletor real | 🔲 Planejado |
