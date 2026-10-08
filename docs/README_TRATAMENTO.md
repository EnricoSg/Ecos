# Tratamento de Telemetria — Engenharia de Dados

**Responsável:** Lucas Coussirat (Engenharia de Dados)
**Módulo:** [`src/validador.js`](../src/validador.js)
**Testes:** [`tests/validador.test.js`](../tests/validador.test.js)

---

## 1. Papel do módulo

O `validador.js` é o **filtro de segurança** entre o módulo coletor e o banco PostgreSQL. Todo pacote de telemetria deve passar por ele antes de ser gravado. Ele faz três coisas:

1. **Bloqueia** qualquer pacote que possa conter texto literal ou dados não autorizados (Regra de Ouro: sem keylogging de conteúdo).
2. **Valida** a estrutura e a coerência numérica dos metadados comportamentais.
3. **Normaliza** os campos para o formato de persistência.

```text
Coletor ──► validarTelemetria(payload) ──┬─► { sucesso: true,  dados }                       ──► PostgreSQL
                                         ├─► { sucesso: false, erro: 'Violação de LGPD' }   (descartado + alerta)
                                         └─► { sucesso: false, erro: 'Estrutura inválida' } (descartado)
```

Um pacote rejeitado **nunca** devolve o campo `dados`, por isso não há caminho para que conteúdo bloqueado chegue ao banco.

## 2. Contrato de entrada

Pacote JSON emitido pelo coletor (mesmo formato do [`telemetria-mock.json`](../telemetria-mock.json)):

```json
{
  "userId": "a2a0159acf6ac55f05c0c4d4bdc54004",
  "timestamp": 1790723199823,
  "dwellTime": 103,
  "flightTime": 68,
  "mouseSpeed": 476
}
```

| Campo | Tipo | Regra | Significado |
|---|---|---|---|
| `userId` | string | Hash hexadecimal de 32 a 64 caracteres | Identificador pseudonimizado (MD5/SHA-256) |
| `timestamp` | inteiro | Epoch em milissegundos, `> 0` | Momento do evento |
| `dwellTime` | number | Finito, `>= 0` | Tempo que a tecla ficou pressionada (ms) |
| `flightTime` | number | Finito, `>= 0` | Intervalo entre soltar uma tecla e pressionar a próxima (ms) |
| `mouseSpeed` | number | Finito, `>= 0` | Velocidade do cursor (px/s) |

## 3. Camadas de proteção

### 3.1 Lista branca de campos (anti-keylogging)
Apenas os 5 campos acima são aceitos (`CAMPOS_PERMITIDOS`). **Qualquer** outro campo, seja `tecla`, `text`, `keyCode`, `clipboard`, `screenshot`, um objeto aninhado ou um nome inventado, faz o pacote inteiro ser rejeitado com `Violação de LGPD` e gera um `🔴 ALERTA DE SEGURANÇA` no log.

> **Por que lista branca e não lista negra?** Uma lista negra (`['key', 'tecla', 'text', ...]`) só bloqueia os nomes que alguém lembrou de incluir: `{ "digitado": "minha senha" }` passaria. A lista branca segue o princípio da **minimização de dados** (LGPD, art. 6º, III): se o campo não é estritamente necessário, não entra.

### 3.2 `userId` sem texto livre
O identificador tem de ser um hash hexadecimal. Isso impede que o próprio ID seja usado como canal para dados pessoais (ex.: `"joao.silva@empresa.com"`) ou texto digitado. O formato é compatível com `colaborador.codigo_anonimo VARCHAR(64)`.

### 3.3 Métricas estritamente numéricas
`dwellTime`, `flightTime` e `mouseSpeed` precisam ser `number` finitos e não negativos: strings (mesmo `"350"`), `NaN`, `Infinity` e negativos são rejeitados. Isso respeita a constraint `chk_telemetria_valores_positivos` do banco.

### 3.4 Timestamp obrigatório e válido
Garante que `new Date(timestamp).toISOString()` nunca lança exceção (um pacote sem timestamp derrubava o processo com `RangeError`).

## 4. Contrato de saída

```json
{
  "sucesso": true,
  "dados": {
    "id_usuario": "a2a0159acf6ac55f05c0c4d4bdc54004",
    "data_evento": "2026-09-29T23:06:39.823Z",
    "tempo_pressao_ms": 103,
    "tempo_voo_ms": 68,
    "velocidade_rato_px": 476
  }
}
```

## 5. Integração com o PostgreSQL (Enrico)

Depois da atualização do banco (commit `c784814`), a tabela `telemetria` armazena **eventos brutos**, um por pacote, o que encaixa diretamente no contrato do validador:

| Saída do validador | Coluna no banco | Observação |
|---|---|---|
| `id_usuario` | `colaborador.codigo_anonimo` → `telemetria.colaborador_id` | Lookup do `id` pelo hash (os hashes do seed coincidem com os do mock) |
| `data_evento` (ISO 8601 UTC) | `telemetria.data_coleta` (`TIMESTAMPTZ`) | Conversão direta |
| `tempo_pressao_ms` | `telemetria.dwell_time` (`INTEGER`) | |
| `tempo_voo_ms` | `telemetria.flight_time` (`INTEGER`) | |
| `velocidade_rato_px` | `telemetria.mouse_speed` (`INTEGER`) | |

### Pontos em aberto

1. **Nomes dos campos de saída.** O validador devolve nomes em português (`tempo_pressao_ms`…), mas o banco usa `dwell_time`, `flight_time` e `mouse_speed`. Proposta: alinhar a saída aos nomes das colunas para eliminar a camada de tradução.
2. **Inteiros.** As colunas são `INTEGER`, mas o validador aceita decimais (ex.: `72.5`), que o PostgreSQL arredondaria em silêncio. Proposta: exigir `Number.isInteger` nas três métricas.
3. **O pipeline da IA ainda não passa pelo filtro.** O [`ai/import_telemetry.py`](../ai/import_telemetry.py) lê o `telemetria-mock.json` e insere diretamente no banco, sem passar pelo `validador.js`. Enquanto a origem for o mock, o risco é baixo (o teste `aprova todos os registos do telemetria-mock.json` confirma que os 1200 registros são válidos), mas com o coletor real **todo pacote tem de ser validado antes da inserção**. Opções a decidir com o **Gustavo** (API) e o **Lucas de Moura** (IA): a API Node chama `validarTelemetria` antes de gravar, ou a mesma regra de lista branca é portada para Python no `import_telemetry.py`.

## 6. Testes

```bash
npm test               # executa a suíte
npm run test:coverage  # com relatório de cobertura
```

A suíte cobre:

- **Telemetria válida:** perfis normal e de fadiga, zero, hash SHA-256, formato exato da saída e **todos os registros do `telemetria-mock.json`**.
- **Anti-keylogging:** campos proibidos (com variações de maiúsculas/minúsculas), campos fora da lista branca, objetos aninhados, texto no `userId`, texto no lugar de métricas, garantia de que nada é devolvido e de que o alerta é registrado.
- **Integridade estrutural:** payloads não-objeto, campos obrigatórios ausentes, `NaN`/`Infinity`/negativos e timestamp ausente sem exceção.

> Qualquer alteração em `CAMPOS_PERMITIDOS` faz o teste `a lista branca contém apenas os 5 metadados matemáticos esperados` falhar de propósito. Adicionar um campo exige revisão consciente e deve passar pela **Auditoria Ética (Davy)**.
