# Ecos — Assinatura Digital Comportamental Corporativa

> MVP para identificação precoce de sinais de **fadiga, estresse e burnout** a partir de mudanças no padrão de interação do colaborador com o computador (teclado e mouse), sem jamais registrar o que é digitado.

![Node.js](https://img.shields.io/badge/Node.js-API%20%C2%B7%20coletor-339933)
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
| Qual tecla foi pressionada | Intervalo entre teclas (*flight time*, ms) |
| Senhas, mensagens, documentos | Velocidade do mouse (px/s) |
| Capturas ou monitoramento de tela, webcam | Carimbo temporal do evento |
| Nome, e-mail ou identidade real | Hash anônimo do colaborador |

Essa regra é aplicada no código, em várias camadas:

- **Coletor:** o código da tecla só existe na memória, para casar o pressionar com o soltar da mesma tecla, e é descartado na hora. Ele nunca entra no lote enviado ([`coletor/captura-nativa.js`](coletor/captura-nativa.js)).
- **API:** o [`src/validador.js`](src/validador.js) rejeita qualquer pacote com campos fora de uma lista branca. A entrada exige a chave do coletor oficial (`X-API-Key`).
- **Dashboard:** setores com menos de 5 colaboradores ativos não têm dados agregados exibidos (`MIN_COLABORADORES_SETOR`), para ninguém ser identificado pela média do grupo.

Detalhes em [`docs/README_TRATAMENTO.md`](docs/README_TRATAMENTO.md).

## Arquitetura

```text
 ┌──────────────────────────────┐
 │ 1. COLETOR  (coletor/)       │  Estação do colaborador, em segundo plano.
 │    captura real ou simulador │  Só tempos e velocidades; envia em lote,
 └──────────────┬───────────────┘  com nova tentativa se a API cair.
                │ POST /api/telemetria  [{ userId (hash), timestamp, dwellTime, flightTime, mouseSpeed }]
                ▼
 ┌──────────────────────────────┐
 │ 2. API  (api/)               │  Node.js + Express. Chave do coletor, validador LGPD,
 │                              │  JWT do RH, rate limit, Helmet. Swagger em /api-docs.
 └───────┬──────────────▲───────┘
   grava │              │ consulta
         ▼              │
 ┌──────────────────────────────┐        ┌───────────────────────────────┐
 │ PostgreSQL  (database/)      │◄──────►│ 3. MOTOR DE IA  (ai/)          │
 │ colaborador · telemetria     │        │ Python. Janelas de 15 min      │
 │ baseline · anomalia · alerta │        │ comparadas ao baseline de cada │
 └──────────────────────────────┘        │ colaborador (z-score robusto). │
                ▲                         └───────────────────────────────┘
                │ via API, com token JWT
 ┌──────────────┴───────────────┐
 │ 4. DASHBOARD RH  (frontend/) │  React + Vite + Tailwind. Cards, tendências por setor,
 │                              │  alertas com detalhe e resolução.
 └──────────────────────────────┘
```

**Por que essa arquitetura:**
- **Uma única porta de entrada (API):** coletor e Dashboard só falam com a API. A validação LGPD e a autenticação ficam num lugar só, e o banco nunca fica exposto.
- **IA separada e em lote:** o motor roda a cada 15 minutos, fora do caminho das requisições. Ele usa o ecossistema Python (pandas/numpy) sem deixar a API mais lenta, e pode rodar em outra máquina.
- **Banco relacional:** as chaves estrangeiras garantem que todo alerta aponta para a anomalia, a telemetria e o baseline que o explicam.
- **Coletor leve e burro:** só mede tempos e manda em lote. Toda a inteligência fica no servidor, e a estação do colaborador não guarda nada.

### 1. Coletor
Agente em segundo plano na estação de trabalho. No modo **real**, usa o [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) para escutar os eventos de teclado e mouse do sistema operacional:
- **dwell time:** tempo entre pressionar e soltar a mesma tecla.
- **flight time:** intervalo entre soltar uma tecla e pressionar a próxima. Pausas acima de 3 s não contam como digitação.
- **velocidade do mouse:** média do último gesto de mouse.

No modo **simulado**, gera as mesmas métricas com distribuições estatísticas (perfis `normal` e `fadiga`), para testes e demonstrações.

### 2. API
Recebe a telemetria do coletor (em lote, com `X-API-Key`), valida pelo filtro LGPD e grava no PostgreSQL. Para o Dashboard, oferece login do RH (JWT) e as rotas de alertas, resumo, detalhe do alerta, anomalias, setores e tendência por setor. A documentação interativa fica em `http://localhost:3000/api-docs`.

### 3. Motor de IA
O motor está em [`ai/`](ai/) e funciona assim:
1. Agrupa a telemetria de cada colaborador em **janelas de 15 minutos**. Uma tecla lenta isolada não indica fadiga; uma janela inteira mais lenta, sim.
2. Compara cada janela com o **baseline do próprio colaborador**, usando um **z-score robusto**: média aparada e desvio absoluto mediano (MAD).
3. Classifica o desvio em `BAIXO`, `MEDIO` ou `ALTO`. Médio e alto geram alerta para o RH, com uma mensagem explicável (ex.: "intervalo entre teclas +108% em relação ao padrão do colaborador").

Enquanto um colaborador não tem 200 eventos de histórico, ele fica em **calibração**, sem alertas. A versão anterior usava Isolation Forest e foi substituída: o porquê está em [`ai/README.md`](ai/README.md).

### 4. Dashboard RH
O [`frontend/`](frontend/) (React + TypeScript + Vite + Tailwind) é usado por profissionais de RH e Psicologia Organizacional. Ele tem:
- **Cards de resumo:** alertas pendentes, nível alto, nível médio e resolvidos, com o tempo médio até resolver.
- **Gráfico de tendência por setor:** dwell time, flight time e velocidade do mouse comparados ao baseline.
- **Lista de alertas pendentes:** com um **detalhe** que mostra a janela avaliada e o desvio de cada métrica, e o botão de **resolver**.

## Estrutura do repositório

```text
Ecos/
├── ai/                    # Motor de IA em Python + gerador de dados de demonstração
├── api/                   # API Node.js/Express (rotas, middlewares de segurança, testes)
├── coletor/               # Coletor: captura real (uiohook-napi) ou simulador
├── database/
│   ├── schema.sql         # Estrutura do banco (já inclui as migrações 001 e 002)
│   ├── seed.sql           # Colaboradores e dados iniciais de teste
│   └── migracoes/         # Para bancos criados antes: 001, 002 e 003 (opcional)
├── docs/                  # Tratamento de dados (LGPD) e histórico do projeto
├── frontend/              # Dashboard RH em React
├── scripts/
│   ├── iniciar.js         # Sobe o sistema inteiro com um comando (npm start)
│   └── python.js          # Roda scripts Python com o .venv do projeto
├── src/validador.js       # Filtro LGPD da telemetria (usado pela API)
├── tests/                 # Testes do validador e do comando único (Jest)
├── telemetria-mock.json   # Telemetria simulada usada nos testes do validador
└── package.json           # Comandos da raiz (npm start, npm test...)
```

## Como executar

**Pré-requisitos:** Node.js 22+, Python 3.10+ e PostgreSQL (testado no 18).

### 1. Primeira vez

```bash
# Banco: crie um banco vazio (ex.: ecos_db) e rode, nesta ordem:
psql -U postgres -d ecos_db -f database/schema.sql
psql -U postgres -d ecos_db -f database/seed.sql
# Banco criado antes de out/2026? Rode as migrações 001 e 002 (veja database/README.md)

# Configuração: copie cada .env.example para .env e preencha
#   api/.env      senha do banco, API_KEY, RH_USUARIO, RH_SENHA, JWT_SECRET
#   ai/.env       senha do banco
#   coletor/.env  API_KEY (a mesma da API) e USER_ID (hash do colaborador desta máquina)

# Dependências Node
npm install
cd api && npm install && cd ..
cd coletor && npm install && cd ..
cd frontend && npm install && cd ..

# Dependências Python (na raiz)
python -m venv .venv
.venv\Scripts\activate          # Windows  (Linux/macOS: source .venv/bin/activate)
pip install -r ai/requirements.txt
```

### 2. Dados de demonstração

```bash
npm run demo:dados                 # cria/renova os colaboradores SINTÉTICOS e roda a IA sobre eles
npm run demo:dados -- --resetar    # o mesmo, mas antes apaga TODA a telemetria, anomalias e alertas
```

O comando cria 5 colaboradores sintéticos por setor, com cerca de 4 semanas de histórico. Na última semana, o Financeiro entra em "fechamento do mês" e desacelera aos poucos, e alguns colaboradores passam do limite. O resultado são **alertas pendentes e já resolvidos**, para o Dashboard ter o que mostrar. As datas são relativas ao dia em que o comando roda; como a IA e os gráficos olham os últimos 30 dias, **rode de novo na véspera da apresentação**.

O colaborador da **captura real** (`USER_ID` do `coletor/.env`) nunca recebe dados sintéticos: o baseline dele vem só da digitação real. O comando mostra também o hash do colaborador do simulador; coloque-o em `USER_ID_SIMULADO` no `coletor/.env`, para o simulador também nunca escrever no colaborador real.

### 3. Rodar o sistema inteiro (um comando)

```bash
npm start                # API + Dashboard + coletor (captura real) + IA a cada 5 minutos
npm run start:simulado   # o mesmo, com o simulador no lugar da captura real
npm run start:fadiga     # simulador com perfil de fadiga (gera alertas)
```

Abra `http://localhost:5173` e entre com `RH_USUARIO` / `RH_SENHA` do `api/.env`. No terminal:
- **Enter** roda a IA na hora, incluindo a janela de 15 minutos ainda em andamento.
- **Ctrl+C** encerra tudo em ordem: o coletor envia o que falta antes de a API sair.

Outras opções: `node scripts/iniciar.js --intervalo-ia=2 --sem-front --sem-coletor`.

Cada parte também roda sozinha: `npm start` em `api/`, `npm run dev` em `frontend/`, `npm run start:real` em `coletor/` e `npm run ia` na raiz.

### 4. Testes

```bash
npm test                                  # raiz: validador LGPD + comando único (62 testes)
cd api && npm test                        # API (149 testes)
cd coletor && npm test                    # coletor e captura real (38 testes)
.venv\Scripts\python -m pytest ai/tests   # IA e gerador de demonstração (33 testes)
cd frontend && npm run build              # checagem de tipos e build do Dashboard
```

Os testes de integração da IA usam o PostgreSQL de verdade, mas desfazem tudo no final.

## Roteiro de demonstração

1. **Calibração do colaborador real (uma vez, antes):** rode `npm start` e digite normalmente por 10 a 15 minutos, em qualquer programa. A cada execução, a IA mostra `Calibração do colaborador 1: N/200 eventos`. Quando aparecer `Baseline ... criado para o colaborador 1`, o padrão real está pronto.
2. **Véspera:** `npm run demo:dados`, para os dados sintéticos ficarem com datas recentes.
3. **Na apresentação:**
   1. Rode `npm start` e entre no Dashboard.
   2. Mostre os cards, a tendência do **Financeiro** (abas dwell, flight e mouse), a lista de alertas, o **detalhe** de um alerta e **resolva** um.
   3. Ao vivo: aperte **Enter** no terminal (zera a janela atual).
   4. Digite **devagar** umas 40 teclas: uma a cada 0,5–1 s, sem pausas maiores que 3 s.
   5. Aperte **Enter** de novo e atualize o Dashboard (F5): aparece o alerta do colaborador real.
4. **Plano B** (antivírus bloqueou a captura do teclado): rode `npm run start:fadiga`, espere 1 ou 2 minutos e aperte Enter.

Deixe claro na apresentação que os demais colaboradores são **dados sintéticos de demonstração**.

**Em produção**, a IA roda agendada a cada 15 minutos, sem o `npm start`:

```bash
# Windows (Agendador de Tarefas), ajuste os caminhos
schtasks /Create /SC MINUTE /MO 15 /TN "Ecos IA" /TR "\"C:\caminho\Ecos\.venv\Scripts\python.exe\" \"C:\caminho\Ecos\ai\pipeline.py\""
# Linux/macOS (cron)
*/15 * * * * cd /caminho/Ecos && .venv/bin/python ai/pipeline.py
```

## Equipe

| Integrante | Papel | Responsabilidades |
|---|---|---|
| **Davy** | Scrum Master · QA · Auditoria Ética | Gerenciamento do projeto, qualidade e auditoria de conformidade com a LGPD |
| **Lucas Coussirat** | Engenharia de Dados | Tratamento e validação da telemetria; suporte na modelagem de IA |
| **Lucas de Moura** | Engenharia de IA | Motor de detecção de anomalias (baseline individual e z-score robusto) |
| **Gustavo** | Backend | API e integração entre os módulos |
| **Marcelo** | Frontend | UX/UI do Dashboard para RH |
| **Enrico** | Arquitetura · Segurança · Banco de Dados | Arquitetura do sistema, segurança e banco PostgreSQL |

## Estado atual do MVP

| Componente | Estado |
|---|---|
| Banco de dados (schema, seed, migrações, índices) | ✅ `database/` |
| Validador / filtro LGPD | ✅ `src/` |
| API (telemetria em lote, login JWT, alertas, tendências, segurança) | ✅ `api/` |
| Coletor: captura real do teclado e mouse + simulador | ✅ `coletor/` |
| Motor de IA (baseline individual, janelas, alertas explicáveis) | ✅ `ai/` |
| Dashboard RH (cards, tendências, detalhe e resolução de alertas) | ✅ `frontend/` |
| Sistema inteiro com um comando + dados de demonstração | ✅ `scripts/` e `ai/gerar_demo.py` |

### Limitações conhecidas
- **Login do RH:** um único usuário, definido no `api/.env`. Ainda não há tabela de usuários nem perfis de acesso.
- **Coletor:** roda pelo terminal, sem instalador nem serviço do sistema. No Windows, não enxerga janelas abertas como administrador, e antivírus corporativos podem bloquear a captura global do teclado.
- **Eventos só de mouse:** não geram pacote. A velocidade do mouse acompanha a próxima tecla digitada.
- **Rate limit:** os contadores ficam em memória, o que só funciona com uma instância da API.
- **Ambiente local:** usa HTTP, sem HTTPS.
- **Validação da IA:** os limiares foram ajustados com dados simulados. Não houve validação com usuários reais nem validação clínica: um alerta é um desvio estatístico, não um diagnóstico.
- **Fuso das datas:** a migração `003_datas_fuso.sql` (opcional) não foi aplicada. Parte das datas fica sem fuso no banco, o que funciona enquanto servidor e banco usam o mesmo fuso.
- **Conformidade LGPD (documentos):** o RIPD, o termo de consentimento e a política de retenção ainda não foram escritos. Há uma sugestão de retenção de 90 dias, comentada em `database/migracoes/002_indices_api.sql`.
- **Banco:** a API e a IA conectam com o usuário `postgres`. Falta um usuário com permissões mínimas.
- **Integração contínua:** não há CI; as suítes de teste rodam localmente.
