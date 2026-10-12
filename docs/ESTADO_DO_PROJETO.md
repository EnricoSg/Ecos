# Ecos — Estado Atual do Projeto e Roteiro para Conclusão

**Data do levantamento:** 12/10/2026
**Referência:** branch `main` (commit `c84aa89`) + trabalho local ainda não publicado (pasta `api/`)
**Elaborado por:** Lucas Coussirat (Engenharia de Dados)

---

## 1. Resumo executivo

O Ecos já tem **a base de dados, o filtro LGPD e o motor de IA funcionando de forma isolada**, mas os módulos **ainda não conversam entre si de ponta a ponta**. Faltam as duas pontas do sistema: a **entrada** (coletor real de teclado/mouse) e a **saída** (dashboard do RH com dados reais). A API que liga tudo foi iniciada, mas ainda não está na `main`.

```text
 Coletor real ──► API ──► Validador ──► PostgreSQL ──► IA ──► PostgreSQL ──► API ──► Dashboard RH
     🔲            🟡         ✅            ✅          🟡                       🔲          🔲
```

| Legenda | Significado |
|---|---|
| ✅ | Pronto para o MVP |
| 🟡 | Funciona, mas tem lacunas ou não está integrado |
| 🔲 | Não iniciado |

---

## 2. Estado por módulo

### 2.1 Banco de Dados — Enrico ✅

**O que existe** (`database/`)
- Schema com 5 tabelas: `colaborador`, `telemetria`, `baseline`, `anomalia` e `alerta`, com chaves estrangeiras, constraints de validação (valores ≥ 0, níveis `BAIXO/MEDIO/ALTO`, status `PENDENTE/RESOLVIDO`) e índices.
- `telemetria` alinhada com o formato do coletor (`dwell_time`, `flight_time`, `mouse_speed`, `data_coleta TIMESTAMPTZ`).
- Seed com 3 colaboradores fictícios cujos hashes coincidem com os do `telemetria-mock.json`.
- README com instruções de instalação e de validação.

**O que falta**
- Política de **retenção e eliminação** de telemetria antiga (exigência da LGPD: os dados não devem ser guardados para sempre).
- Utilizadores do banco com **permissões mínimas** (hoje tudo usa `postgres`).
- Tabela ou estratégia para **utilizadores do RH** (necessária para o login do dashboard).
- Mecanismo de migrações (hoje, qualquer mudança no schema exige recriar o banco).

### 2.2 Tratamento de Telemetria / Validador — Lucas Coussirat ✅

**O que existe** (`src/validador.js`, `tests/`, `docs/README_TRATAMENTO.md`)
- Filtro LGPD com **lista branca**: só aceita `userId`, `timestamp`, `dwellTime`, `flightTime` e `mouseSpeed`. Qualquer outro campo (texto, tecla, clipboard…) bloqueia o pacote inteiro.
- O `userId` tem de ser um hash hexadecimal, o que impede que o identificador transporte texto ou dados pessoais.
- **47 testes automatizados** (Jest), incluindo a validação dos 1200 registros do mock.

**O que falta**
- Alinhar os nomes de saída (`tempo_pressao_ms`…) com as colunas do banco (`dwell_time`…). Hoje a API faz essa tradução.
- Exigir números inteiros diretamente no validador. Hoje a API faz essa verificação.

### 2.3 API / Backend — Gustavo 🟡

**O que existe** (`api/`, ainda **apenas local**, não publicado na `main`)
- Servidor Node.js + Express com `POST /api/telemetria`: valida com o `validador.js`, grava no PostgreSQL e devolve 201 / 400 / 404 / 413 / 500.
- `GET /api/health` para verificar a ligação ao banco.
- Configuração por `.env`, CORS para o dashboard e **19 testes automatizados**.
- **Ainda não testada contra um PostgreSQL real.**

**O que falta**
- **Publicar** a pasta `api/` na `main` (via PR).
- **Rotas de leitura para o dashboard:**
  - `GET /api/alertas` (filtro por status e setor)
  - `PATCH /api/alertas/:id` (marcar como resolvido)
  - `GET /api/anomalias` e `GET /api/setores/:setor/tendencia` (dados agregados para os gráficos)
- **Autenticação do RH** (login + token JWT) e proteção das rotas de leitura.
- **Autenticação do coletor** (chave de API) para impedir que qualquer pessoa envie telemetria falsa.
- Limite de requisições (rate limiting) e suporte a envio em lote (o coletor real vai gerar muitos eventos por minuto).

### 2.4 Motor Analítico / IA — Lucas de Moura 🟡

**O que existe** (`ai/`)
- `anomaly_detector.py`: Isolation Forest (100 árvores, contaminação de 5%) que classifica cada evento como `NORMAL` ou `ANOMALIA` e calcula o baseline só com os eventos normais. **Testado: 1200 registros → 60 anomalias.**
- Scripts de persistência: importar telemetria, gravar baselines, gravar anomalias com nível e gerar alertas para os níveis `MEDIO` e `ALTO`.

**O que falta**
- **Ler do banco em vez do JSON.** Hoje a análise lê o `telemetria-mock.json`, por isso a telemetria recebida pela API nunca chega à IA.
- **Modelo por colaborador.** O modelo atual é treinado com os dados de todos os colaboradores juntos. A proposta do Ecos é comparar cada pessoa com o **seu próprio** padrão.
- **Análise por janela de tempo.** Um evento isolado lento não indica fadiga; o burnout aparece como **tendência ao longo de dias**. É preciso agregar por hora/dia antes de classificar, para reduzir falsos alertas.
- **Contaminação fixa em 5%.** O modelo vai marcar 5% dos eventos como anomalia mesmo que todos estejam bem. É preciso calibrar ou usar um limiar baseado no desvio do baseline.
- **Execução automática** (agendada, por exemplo, de hora em hora). Hoje os 4 scripts são executados à mão e por ordem.
- `import_telemetry.py` grava no banco **sem passar pelo validador LGPD**. Deve deixar de ser usado assim que a API estiver em produção.
- Configuração do banco repetida em 4 ficheiros e ausência de testes automatizados em Python.

### 2.5 Frontend / Dashboard RH — Marcelo 🔲

**O que existe** (`frontend/`)
- Projeto React + TypeScript + Vite + Tailwind configurado, que compila sem erros.
- Bibliotecas já instaladas para as próximas fases: `axios` (API), `recharts` (gráficos), `react-router-dom` (rotas) e `lucide-react` (ícones).
- Por enquanto, apenas uma página de boas-vindas.

**O que falta**
- Tela de **login** do RH e rotas protegidas.
- **Lista de alertas** (pendentes/resolvidos) com ação de "marcar como resolvido".
- **Gráficos de tendência** (comparação com o baseline, visão por setor) sem expor dados individuais brutos.
- Integração com a API via `axios` (variável `VITE_API_URL`).
- Pequena correção: o `frontend/README.md` termina com os caracteres `''')`, que sobraram de um script.

### 2.6 Módulo Coletor (background) — sem responsável definido 🔲

**O que existe**
- Apenas dados simulados (`telemetria-mock.json`, 1000 eventos normais + 200 de fadiga).

**O que falta**
- Um **agente que corra em segundo plano** na máquina do colaborador e:
  - capture apenas os **tempos** de pressionar/soltar teclas e a velocidade do mouse, **nunca qual tecla**;
  - gere o hash anónimo do colaborador localmente;
  - envie os pacotes à API (com fila local caso esteja sem internet).
- Opção simples para o MVP: um script Node.js com uma biblioteca de hooks de input (ex.: `uiohook-napi`), descartando o código da tecla logo na captura.
- **É preciso definir um responsável:** este módulo não está atribuído a ninguém na divisão atual da equipe.

### 2.7 Governança, Qualidade e LGPD — Davy 🟡

**O que existe**
- A regra de não-keylogging está aplicada no código e coberta por testes.
- READMEs por módulo e documentação técnica do tratamento de dados.

**O que falta**
- **RIPD** (Relatório de Impacto à Proteção de Dados), recomendado pela LGPD para tratamento de dados de saúde/comportamento.
- **Termo de consentimento** e de transparência para os colaboradores.
- Definição de **quem pode ver o quê** no dashboard (ex.: o RH vê tendências por setor; alertas individuais só pela Psicologia).
- **Integração contínua** (GitHub Actions a correr os testes em cada PR); hoje não há CI.
- Plano de testes de ponta a ponta para a demonstração final.

---

## 3. Riscos atuais

| Risco | Impacto | Mitigação |
|---|---|---|
| Coletor sem responsável | Sem coletor, a demonstração depende só do mock | Atribuir já; usar o mock como plano B |
| IA lê o JSON, não o banco | Os dados que entram pela API não geram alertas | Prioridade 1 da IA |
| Modelo global com contaminação fixa | Falsos alertas no dashboard, o que mina a confiança do RH | Modelo por colaborador + janelas de tempo |
| API só local e não testada com banco real | Integração pode falhar perto da entrega | Publicar e testar com PostgreSQL nesta sprint |
| Sem autenticação | Qualquer pessoa pode ler alertas ou enviar dados falsos | JWT para o RH + chave de API para o coletor |

---

## 4. Roteiro proposto até à conclusão

### Fase 1 — Integração mínima (próxima sprint)
- [ ] Publicar `api/` na `main` e testá-la com PostgreSQL real *(Gustavo / Lucas C.)*
- [ ] IA passa a ler a telemetria do banco *(Lucas M.)*
- [ ] Rotas `GET /api/alertas` e `PATCH /api/alertas/:id` *(Gustavo)*
- [ ] Dashboard lista os alertas reais vindos da API *(Marcelo)*
- [ ] Definir o responsável pelo coletor *(Davy)*

**Marco:** um pacote enviado à API aparece como alerta no dashboard.

### Fase 2 — Produto utilizável
- [ ] Coletor em background enviando telemetria real *(responsável a definir)*
- [ ] Modelo por colaborador com análise por janelas de tempo *(Lucas M. / Lucas C.)*
- [ ] Execução automática do pipeline da IA *(Lucas M.)*
- [ ] Login do RH com JWT e rotas protegidas *(Gustavo / Marcelo)*
- [ ] Gráficos de tendência por setor *(Marcelo)*

**Marco:** fluxo completo com dados reais, do teclado ao dashboard.

### Fase 3 — Conformidade e entrega
- [ ] RIPD, termo de consentimento e política de retenção *(Davy / Enrico)*
- [ ] Permissões mínimas no banco e chave de API do coletor *(Enrico / Gustavo)*
- [ ] CI com GitHub Actions *(Davy / Enrico)*
- [ ] Teste de ponta a ponta e roteiro da demonstração *(Davy)*
- [ ] README final com instruções completas de instalação *(todos)*

**Marco:** MVP entregue, demonstrável e auditado.

---

## 5. Como verificar o estado atual

Instruções detalhadas no [README principal](../README.md). Resumo:

```bash
npm test                          # validador (47 testes)
cd api && npm test                # API (19 testes, banco simulado)
python ai/anomaly_detector.py     # IA sobre o mock (1200 registros → 60 anomalias)
cd frontend && npm run dev        # dashboard em http://localhost:5173
```
