# Módulo de IA — Ecos

Motor de detecção de anomalias comportamentais do **Ecos — Assinatura Digital Comportamental Corporativa**. Lê a telemetria gravada pela API no PostgreSQL, compara cada colaborador com o **seu próprio** baseline e gera anomalias e alertas para o Dashboard do RH.

Só são usados metadados de tempo e velocidade (`dwell_time`, `flight_time`, `mouse_speed`). Não existe conteúdo digitado nem identificação de teclas no banco.

## Como funciona

Cada execução faz tudo em **uma transação**: grava tudo ou não grava nada.

1. **Lê a telemetria pendente**, ou seja, onde `telemetria.analisada_em IS NULL`.
2. **Agrupa em janelas de tempo** (padrão: 15 min) por colaborador. Uma tecla lenta isolada não indica fadiga; uma janela inteira mais lenta, sim. A janela que ainda está em andamento espera a próxima execução.
3. **Compara com o baseline** da tabela `baseline`. Para cada métrica:

   ```
   z = (média aparada da janela − média do baseline) / dispersão típica do colaborador
   ```

   - A **média aparada** descarta os 10% extremos de cada lado (pausas para pensar, toques acidentais).
   - A **dispersão típica** é o desvio absoluto mediano (MAD) do histórico analisado nos últimos 30 dias.
   - A `pontuacao_desvio` é a raiz da média dos z² das três métricas.
4. **Define o nível** pela pontuação e grava em `anomalia`:

   | Pontuação | Nível | Alerta para o RH |
   |---|---|---|
   | < 1,25 | normal (não grava) | — |
   | 1,25 – 1,75 | `BAIXO` | não |
   | 1,75 – 2,5 | `MEDIO` | sim, `PENDENTE` |
   | ≥ 2,5 | `ALTO` | sim, `PENDENTE` |

5. **Marca as telemetrias como analisadas** e cria um baseline novo quando o atual tem mais de 7 dias. Cria uma linha nova em vez de sobrescrever, para cada anomalia continuar apontando para o baseline com que foi comparada.

**Calibração:** enquanto um colaborador não tiver baseline e pelo menos 200 eventos de histórico, as janelas dele só são marcadas como analisadas, sem gerar alertas.

**Validação com os perfis do simulador do coletor:**
- **Perfil normal:** 0 alertas em 300 janelas.
- **Perfil de fadiga:** alerta em mais de 98% das janelas.

### Por que não Isolation Forest

A versão anterior usava `IsolationForest(contamination=0.05)`. Ela marcava 5% dos eventos como anomalia mesmo com todos bem, não usava a tabela `baseline` e pontuava tecla a tecla: uma pausa de 2 segundos já virava alerta ALTO.

O escore em relação ao baseline também é **explicável**. O alerta diz, por exemplo, "intervalo entre teclas +88% em relação ao padrão do colaborador". Isso é importante para a revisão de decisões automatizadas prevista na LGPD (art. 20).

## Instalação

```bash
# Na raiz do projeto, com o ambiente virtual ativado
.venv\Scripts\activate              # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r ai/requirements.txt

# Credenciais do banco (mesmos nomes de variáveis da API)
copy ai\.env.example ai\.env        # e preencha ECOS_DB_PASSWORD

# Uma única vez por banco: coluna de controle do processamento
psql -U postgres -d ecos_db -f database/migracoes/001_telemetria_analisada_em.sql
```

## Uso

```bash
python ai/pipeline.py                          # processa e grava
python ai/pipeline.py --simular                # mostra o resultado sem gravar nada
python ai/pipeline.py --incluir-janela-aberta  # avalia também a janela em andamento (útil em demonstrações)
python ai/pipeline.py --recalcular-baseline    # força um baseline novo a partir do histórico
python ai/pipeline.py --janela-minutos 5       # janelas menores
python -m pytest ai/tests                      # testes (o de integração usa o banco e desfaz tudo)
```

Em produção, agende `python ai/pipeline.py` a cada 15 minutos (Agendador de Tarefas do Windows ou cron). Duas execuções simultâneas não processam o mesmo evento, graças ao `FOR UPDATE SKIP LOCKED`.

Os parâmetros (tamanho da janela, limiares, histórico mínimo…) ficam no `ai/.env`. Veja o `ai/.env.example`.

## Arquivos

| Arquivo | Função |
|---|---|
| `anomaly_detector.py` | Motor de detecção: leitura, janelas, pontuação, anomalias, alertas e baselines |
| `banco.py` | Conexão com o PostgreSQL, lendo o `ai/.env` |
| `pipeline.py` | Ponto de entrada para agendamento |
| `import_telemetry.py` | **Legado**: importa o `telemetria-mock.json` direto no banco, **sem passar pelo validador LGPD**. Use só para carga de testes; os dados reais entram pela API |
| `tests/` | Testes unitários e de integração (pytest) |
