"""
ECOS - Gerador de dados de demonstração

Cria colaboradores SINTÉTICOS com ~4 semanas de telemetria simulada e roda o motor de IA
sobre eles, para o Dashboard ter tendências por setor, alertas pendentes e alertas já resolvidos.
Cada setor ganha 5 colaboradores sintéticos: o mínimo da regra de privacidade da API
(MIN_COLABORADORES_SETOR=5), mesmo sem contar os colaboradores do seed.

Roteiro dos dados, relativo ao dia em que o script roda (só dias úteis, no horário de expediente):
  - semanas anteriores: todos com comportamento normal. A IA calibra e cria o baseline de cada um;
  - última semana: o Financeiro entra no "fechamento do mês" e desacelera aos poucos (tendência do setor).
    Três pessoas do Financeiro e uma de TI passam do limite nos últimos 3 dias úteis: alertas PENDENTES;
  - início da última semana: episódios isolados em TI, RH e Financeiro, já acompanhados pelo RH: RESOLVIDOS.

Os dados são sintéticos e devem ser apresentados como tal. O colaborador da captura real
(USER_ID do coletor/.env) nunca recebe dados daqui: o baseline dele vem só da digitação real.
O colaborador "simulador" (primeiro de TI, USER_ID_SIMULADO do coletor/.env) segue exatamente o
perfil normal do simulador do coletor: com --perfil=fadiga o coletor gera alertas para ele.

Uso:
  python ai/gerar_demo.py                        # gera tudo numa transação e desfaz no final (nada é gravado)
  python ai/gerar_demo.py --confirmar            # grava, substituindo os dados sintéticos anteriores
  python ai/gerar_demo.py --confirmar --resetar  # antes, apaga TODA a telemetria, anomalias, alertas e baselines
"""

import argparse
import hashlib
import math
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np

import anomaly_detector as ia
from banco import conectar_banco


# =====================================================
# ROTEIRO DA DEMONSTRAÇÃO
# =====================================================

SETORES = ("Tecnologia da Informação", "Financeiro", "Recursos Humanos")
SINTETICOS_POR_SETOR = 5

# O primeiro colaborador sintético de TI segue o perfil do simulador sem variação individual
COLABORADOR_SIMULADOR = ("Tecnologia da Informação", 0)

DIAS_HISTORICO = 28   # dias corridos para trás (a IA e os gráficos olham os últimos 30)
DIAS_RECENTES = 5     # últimos dias úteis: tendência do Financeiro e episódios de fadiga
DIAS_RESOLVIDOS = 2   # alertas dos primeiros dias recentes já foram resolvidos pelo RH

# Expediente (horário local): só janelas que cabem inteiras nesses períodos recebem eventos
MANHA = (time(9, 0), time(12, 0))
TARDE = (time(13, 30), time(18, 0))

# Desaceleração gradual de TODO o Financeiro nos dias recentes (intensidade de fadiga por dia).
# Até 0,35, 98% das janelas ficam sem anomalia: aparece na tendência do setor, não como alerta individual.
TENDENCIA_FINANCEIRO = (0.07, 0.14, 0.21, 0.28, 0.35)


@dataclass(frozen=True)
class Episodio:
    """Uma janela da tarde em que um colaborador sintético fica bem mais lento que o seu padrão."""

    setor: str
    indice: int          # qual colaborador sintético do setor (0 a SINTETICOS_POR_SETOR - 1)
    dia: int             # índice entre os DIAS_RECENTES dias úteis (0 = o mais antigo, 4 = ontem)
    # Medido com o próprio motor da IA: 0,9 vira alerta em ~92% das janelas (a maioria MEDIO); 1,5 ou mais, sempre ALTO
    intensidade: float


EPISODIOS = (
    # Fechamento do mês no Financeiro: três pessoas passam do limite nos últimos dias (pendentes)
    Episodio("Financeiro", 1, 2, 0.9),
    Episodio("Financeiro", 1, 3, 1.5),
    Episodio("Financeiro", 1, 4, 1.9),
    Episodio("Financeiro", 2, 3, 0.9),
    Episodio("Financeiro", 2, 4, 1.6),
    Episodio("Financeiro", 3, 4, 0.9),
    Episodio("Tecnologia da Informação", 2, 4, 1.0),
    # Episódios isolados no início da semana, já acompanhados pelo RH (resolvidos)
    Episodio("Financeiro", 4, 0, 1.6),
    Episodio("Tecnologia da Informação", 3, 1, 0.9),
    Episodio("Recursos Humanos", 1, 0, 0.9),
    Episodio("Recursos Humanos", 3, 1, 1.5),
)


# =====================================================
# SIMULAÇÃO DAS MÉTRICAS
# =====================================================

# Mesmos parâmetros do simulador do coletor (coletor/index.js, PERFIS)
#   dwell/flight: (mediana, dispersão log-normal, mínimo, máximo) em ms
#   pausa: (probabilidade, mínimo, máximo) em ms, somada ao flight
#   mouse: (média, desvio, mínimo, máximo) em px/s
NORMAL = {
    "dwell": (95, 0.22, 40, 300),
    "flight": (85, 0.35, 15, 800),
    "pausa": (0.04, 500, 2500),
    "mouse": (480, 110, 50, 1500),
}
FADIGA = {
    "dwell": (135, 0.32, 50, 450),
    "flight": (160, 0.45, 20, 1200),
    "pausa": (0.10, 800, 4000),
    "mouse": (320, 120, 30, 1200),
}

ASSINATURA_NEUTRA = {"dwell": 1.0, "flight": 1.0, "mouse": 1.0}


def perfil(intensidade: float) -> dict:
    """0 = perfil normal do simulador, 1 = perfil de fadiga. Acima de 1, fadiga mais forte (extrapola)."""

    return {
        chave: tuple(n + intensidade * (f - n) for n, f in zip(NORMAL[chave], FADIGA[chave]))
        for chave in NORMAL
    }


def gerar_eventos(rng, quantidade: int, intensidade: float = 0.0, assinatura: dict | None = None) -> dict:
    """Métricas de `quantidade` teclas. A assinatura multiplica os valores típicos do colaborador."""

    p = perfil(intensidade)
    a = assinatura or ASSINATURA_NEUTRA

    mediana, dispersao, minimo, maximo = p["dwell"]
    dwell = np.clip(mediana * a["dwell"] * np.exp(dispersao * rng.standard_normal(quantidade)), minimo, maximo)

    mediana, dispersao, minimo, maximo = p["flight"]
    flight = np.clip(mediana * a["flight"] * np.exp(dispersao * rng.standard_normal(quantidade)), minimo, maximo)
    probabilidade, pausa_minima, pausa_maxima = p["pausa"]
    flight += (rng.random(quantidade) < probabilidade) * rng.uniform(pausa_minima, pausa_maxima, quantidade)

    media, desvio, minimo, maximo = p["mouse"]
    mouse = np.clip(media * a["mouse"] + desvio * rng.standard_normal(quantidade), max(minimo, 0), maximo)

    # A API e o banco usam inteiros
    return {
        "dwell_time": np.round(dwell).astype(int),
        "flight_time": np.round(flight).astype(int),
        "mouse_speed": np.round(mouse).astype(int),
    }


# =====================================================
# CALENDÁRIO
# =====================================================

def dias_uteis(hoje: date, dias: int) -> list[date]:
    """Dias úteis (segunda a sexta) dos `dias` dias corridos antes de hoje. Hoje não entra."""

    return [
        dia
        for dia in (hoje - timedelta(days=atras) for atras in range(dias, 0, -1))
        if dia.weekday() < 5
    ]


def janelas_do_periodo(dia: date, periodo: tuple[time, time], minutos: int, fuso: ZoneInfo) -> list[datetime]:
    """
    Inícios (UTC) das janelas da IA que cabem inteiras no período.
    O alinhamento é o mesmo da IA: blocos de `minutos` contados desde a época Unix.
    """

    segundos = minutos * 60
    comeco = datetime.combine(dia, periodo[0], fuso).timestamp()
    fim = datetime.combine(dia, periodo[1], fuso).timestamp()

    inicio = math.ceil(comeco / segundos) * segundos
    return [
        datetime.fromtimestamp(instante, timezone.utc)
        for instante in range(int(inicio), int(fim) - segundos + 1, segundos)
    ]


def codigo_sintetico(setor: str, indice: int) -> str:
    """Hash anônimo determinístico: rodar de novo reaproveita os mesmos colaboradores."""

    return hashlib.sha256(f"ecos-demo:{setor}:{indice}".encode("utf-8")).hexdigest()[:32]


# =====================================================
# BANCO DE DADOS
# =====================================================

SQL_RESETAR = (
    "TRUNCATE alerta, anomalia, baseline, telemetria RESTART IDENTITY;",
    # Colaboradores não são apagados; só a numeração volta para logo depois do último existente
    "SELECT setval(pg_get_serial_sequence('colaborador', 'id'), COALESCE((SELECT max(id) FROM colaborador), 1));",
)

SQL_COLABORADOR = """
    INSERT INTO colaborador (codigo_anonimo, setor, ativo)
    VALUES (%s, %s, TRUE)
    ON CONFLICT (codigo_anonimo) DO UPDATE SET setor = EXCLUDED.setor, ativo = TRUE
    RETURNING id;
"""

# Ordem das chaves estrangeiras: alerta -> anomalia -> baseline/telemetria
SQL_APAGAR_SINTETICOS = (
    "DELETE FROM alerta WHERE anomalia_id IN (SELECT id FROM anomalia WHERE colaborador_id = ANY(%(ids)s));",
    "DELETE FROM anomalia WHERE colaborador_id = ANY(%(ids)s);",
    "DELETE FROM baseline WHERE colaborador_id = ANY(%(ids)s);",
    "DELETE FROM telemetria WHERE colaborador_id = ANY(%(ids)s);",
)

SQL_COPIAR_TELEMETRIA = "COPY telemetria (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta) FROM STDIN"

# A IA roda aqui uma vez só, mas na vida real rodaria a cada 15 minutos. Para os horários fazerem sentido
# no Dashboard, cada anomalia/alerta recebe o momento em que teria sido detectado: fim da janela + 1 a 13 min.
SQL_AJUSTAR_DETECCAO = """
    UPDATE anomalia an
    SET data_deteccao = to_timestamp((floor(EXTRACT(EPOCH FROM t.data_coleta) / %(janela)s) + 1) * %(janela)s)
                        + make_interval(secs => 60 + (an.id * 389) %% 720)
    FROM telemetria t
    WHERE t.id = an.telemetria_id
      AND an.colaborador_id = ANY(%(ids)s);
"""

SQL_AJUSTAR_CRIACAO_ALERTA = """
    UPDATE alerta al
    SET data_criacao = an.data_deteccao
    FROM anomalia an
    WHERE an.id = al.anomalia_id
      AND an.colaborador_id = ANY(%(ids)s);
"""

# Alertas do início da semana já foram atendidos pelo RH (entre 2 e 31 horas depois de criados)
SQL_RESOLVER_ANTIGOS = """
    UPDATE alerta al
    SET status = 'RESOLVIDO',
        data_resolucao = LEAST(al.data_criacao + make_interval(hours => 2 + (al.id * 7) %% 30),
                               LOCALTIMESTAMP - interval '1 hour')
    FROM anomalia an
    WHERE an.id = al.anomalia_id
      AND an.colaborador_id = ANY(%(ids)s)
      AND an.data_deteccao < %(inicio_pendentes)s;
"""

# O baseline foi "calculado" no fim do histórico normal, antes dos episódios
SQL_AJUSTAR_BASELINES = "UPDATE baseline SET data_calculo = %(quando)s WHERE colaborador_id = ANY(%(ids)s);"

SQL_ALERTAS_POR_SETOR = """
    SELECT c.setor, an.nivel, al.status, COUNT(*)::int AS quantidade
    FROM alerta al
    JOIN anomalia an ON an.id = al.anomalia_id
    JOIN colaborador c ON c.id = an.colaborador_id
    WHERE c.id = ANY(%(ids)s)
    GROUP BY 1, 2, 3
    ORDER BY 1, 3, 2;
"""

SQL_COLABORADORES_POR_SETOR = """
    SELECT setor, COUNT(*)::int AS ativos
    FROM colaborador
    WHERE ativo
    GROUP BY setor
    ORDER BY setor;
"""

# Colaboradores fora da demonstração (ex.: o da captura real) e o quanto já têm de histórico
SQL_OUTROS_COLABORADORES = """
    SELECT c.id, c.setor,
           COUNT(t.id)::int AS eventos,
           EXISTS (SELECT 1 FROM baseline b WHERE b.colaborador_id = c.id) AS tem_baseline
    FROM colaborador c
    LEFT JOIN telemetria t ON t.colaborador_id = c.id
    WHERE c.ativo AND NOT (c.id = ANY(%(ids)s))
    GROUP BY c.id, c.setor
    ORDER BY c.id;
"""


@dataclass
class Sintetico:
    setor: str
    indice: int
    codigo: str
    id: int
    assinatura: dict


def criar_colaboradores(cursor, rng) -> list[Sintetico]:
    colaboradores = []

    for setor in SETORES:
        for indice in range(SINTETICOS_POR_SETOR):
            codigo = codigo_sintetico(setor, indice)
            cursor.execute(SQL_COLABORADOR, (codigo, setor))

            # Cada pessoa tem o seu ritmo: é contra ele, e não contra uma média geral, que a IA compara
            assinatura = (
                ASSINATURA_NEUTRA
                if (setor, indice) == COLABORADOR_SIMULADOR
                else {
                    "dwell": rng.uniform(0.85, 1.2),
                    "flight": rng.uniform(0.8, 1.3),
                    "mouse": rng.uniform(0.8, 1.2),
                }
            )
            colaboradores.append(Sintetico(setor, indice, codigo, cursor.fetchone()[0], assinatura))

    return colaboradores


def gerar_telemetria(rng, colaboradores, dias, config: ia.Config, fuso: ZoneInfo, recentes: bool) -> list[tuple]:
    """Linhas (colaborador_id, dwell, flight, mouse, data_coleta) de cada colaborador em cada dia."""

    episodios = {(e.setor, e.indice, e.dia): e.intensidade for e in EPISODIOS}
    linhas = []

    for colaborador in colaboradores:
        for posicao, dia in enumerate(dias):
            manha = janelas_do_periodo(dia, MANHA, config.janela_minutos, fuso)
            tarde = janelas_do_periodo(dia, TARDE, config.janela_minutos, fuso)
            escolhidas_manha = sorted(rng.choice(len(manha), size=min(2, len(manha)), replace=False))
            escolhidas_tarde = sorted(rng.choice(len(tarde), size=min(int(rng.integers(2, 5)), len(tarde)), replace=False))
            janelas = [manha[i] for i in escolhidas_manha] + [tarde[i] for i in escolhidas_tarde]

            # Variação natural de um dia para o outro (sono, carga, café...)
            fator_dia = {m: rng.normal(1, 0.03) for m in ("dwell", "flight", "mouse")}
            assinatura = {m: colaborador.assinatura[m] * fator_dia[m] for m in fator_dia}

            base = 0.0
            if recentes and colaborador.setor == "Financeiro":
                base = TENDENCIA_FINANCEIRO[posicao]
            episodio = episodios.get((colaborador.setor, colaborador.indice, posicao)) if recentes else None

            for numero, inicio in enumerate(janelas):
                # O episódio cai na última janela da tarde: o cansaço aparece no fim do dia
                intensidade = episodio if episodio is not None and numero == len(janelas) - 1 else base

                quantidade = int(rng.integers(config.min_eventos_janela + 8, config.min_eventos_janela + 40))
                metricas = gerar_eventos(rng, quantidade, intensidade, assinatura)
                segundos = np.sort(rng.uniform(2, config.janela_minutos * 60 - 2, quantidade))

                for i in range(quantidade):
                    linhas.append((
                        colaborador.id,
                        int(metricas["dwell_time"][i]),
                        int(metricas["flight_time"][i]),
                        int(metricas["mouse_speed"][i]),
                        inicio + timedelta(seconds=float(segundos[i])),
                    ))

    return linhas


def inserir_telemetria(cursor, linhas: list[tuple]) -> None:
    with cursor.copy(SQL_COPIAR_TELEMETRIA) as copia:
        for linha in linhas:
            copia.write_row(linha)


def rodar_ia(conexao, config: ia.Config, agora: datetime) -> list:
    """Roda o motor até não sobrar telemetria pendente (cada execução lê no máximo IA_LIMITE_EVENTOS)."""

    resumos = []
    while True:
        resumo = ia.processar(conexao, config, agora=agora)
        resumos.append(resumo)
        if resumo.eventos < config.limite_eventos:
            return resumos


def consultar(cursor, sql, parametros=None) -> list[dict]:
    cursor.execute(sql, parametros)
    colunas = [descricao.name for descricao in cursor.description]
    return [dict(zip(colunas, linha)) for linha in cursor.fetchall()]


def gerar(conexao, config: ia.Config, hoje: date, agora: datetime, semente: int, resetar: bool) -> dict:
    """Faz tudo na transação da `conexao`, sem commit: quem chama decide se grava ou desfaz."""

    rng = np.random.default_rng(semente)
    fuso = ZoneInfo(config.fuso_horario)
    dias = dias_uteis(hoje, DIAS_HISTORICO)
    antigos, recentes = dias[:-DIAS_RECENTES], dias[-DIAS_RECENTES:]

    with conexao.cursor() as cursor:
        if resetar:
            for sql in SQL_RESETAR:
                cursor.execute(sql)

        colaboradores = criar_colaboradores(cursor, rng)
        ids = [c.id for c in colaboradores]

        if not resetar:
            for sql in SQL_APAGAR_SINTETICOS:
                cursor.execute(sql, {"ids": ids})

        print(f"Fase 1: histórico normal de {len(antigos)} dias úteis ({antigos[0]:%d/%m} a {antigos[-1]:%d/%m}).")
        historico = gerar_telemetria(rng, colaboradores, antigos, config, fuso, recentes=False)
        inserir_telemetria(cursor, historico)

    # Calibração: sem baseline, a IA só marca as janelas como analisadas e cria o baseline no final
    resumos = rodar_ia(conexao, config, agora)

    with conexao.cursor() as cursor:
        print(f"\nFase 2: última semana, {len(recentes)} dias úteis ({recentes[0]:%d/%m} a {recentes[-1]:%d/%m}).")
        semana = gerar_telemetria(rng, colaboradores, recentes, config, fuso, recentes=True)
        inserir_telemetria(cursor, semana)

    resumos += rodar_ia(conexao, config, agora)

    inicio_pendentes = datetime.combine(recentes[DIAS_RESOLVIDOS], time(0, 0), fuso)
    fim_historico = datetime.combine(antigos[-1], TARDE[1], fuso)

    with conexao.cursor() as cursor:
        cursor.execute(SQL_AJUSTAR_DETECCAO, {"ids": ids, "janela": config.janela_minutos * 60})
        cursor.execute(SQL_AJUSTAR_CRIACAO_ALERTA, {"ids": ids})
        cursor.execute(SQL_RESOLVER_ANTIGOS, {"ids": ids, "inicio_pendentes": inicio_pendentes})
        cursor.execute(SQL_AJUSTAR_BASELINES, {"ids": ids, "quando": fim_historico})

        return {
            "eventos": len(historico) + len(semana),
            "baselines": sum(r.baselines for r in resumos),
            "anomalias": {
                nivel: sum(getattr(r, nivel.lower()) for r in resumos) for nivel in ("BAIXO", "MEDIO", "ALTO")
            },
            "colaboradores": colaboradores,
            "setores": consultar(cursor, SQL_COLABORADORES_POR_SETOR),
            "alertas": consultar(cursor, SQL_ALERTAS_POR_SETOR, {"ids": ids}),
            "outros": consultar(cursor, SQL_OUTROS_COLABORADORES, {"ids": ids}),
        }


# =====================================================
# EXECUÇÃO
# =====================================================

def exibir(resultado: dict, gravado: bool, minimo_historico: int) -> None:
    print("\n=== DADOS DE DEMONSTRAÇÃO (SINTÉTICOS) ===")
    print(f"Colaboradores sintéticos: {len(resultado['colaboradores'])} | eventos: {resultado['eventos']} "
          f"| baselines: {resultado['baselines']}")
    anomalias = resultado["anomalias"]
    print(f"Anomalias: BAIXO {anomalias['BAIXO']}, MEDIO {anomalias['MEDIO']}, ALTO {anomalias['ALTO']}")

    print("\nColaboradores ativos por setor (regra de privacidade: mínimo de 5):")
    for linha in resultado["setores"]:
        print(f"  {linha['setor']}: {linha['ativos']}")

    print("\nAlertas dos colaboradores sintéticos:")
    for linha in resultado["alertas"]:
        print(f"  {linha['setor']}: {linha['quantidade']} {linha['status']} nível {linha['nivel']}")

    simulador = next(c for c in resultado["colaboradores"] if (c.setor, c.indice) == COLABORADOR_SIMULADOR)
    print(f"\nColaborador do simulador (USER_ID_SIMULADO no coletor/.env): {simulador.codigo}")

    if resultado["outros"]:
        print("\nColaboradores fora da demonstração (ex.: captura real), que nunca recebem dados sintéticos:")
        for linha in resultado["outros"]:
            if linha["tem_baseline"]:
                situacao = "baseline pronto"
            elif linha["eventos"]:
                situacao = f"em calibração ({linha['eventos']}/{minimo_historico} eventos)"
            else:
                situacao = "sem telemetria"
            print(f"  colaborador {linha['id']} ({linha['setor']}): {situacao}")

    if not gravado:
        print("\nSIMULAÇÃO: nada foi gravado. Rode com --confirmar para gravar.")


def ler_argumentos(argv=None):
    parser = argparse.ArgumentParser(description="Gera dados SINTÉTICOS de demonstração e roda a IA sobre eles.")
    parser.add_argument("--confirmar", action="store_true", help="grava no banco (sem isto, tudo é desfeito no final)")
    parser.add_argument(
        "--resetar",
        action="store_true",
        help="apaga TODA a telemetria, anomalias, alertas e baselines antes, inclusive os da captura real",
    )
    parser.add_argument("--semente", type=int, default=2026, help="semente aleatória: a mesma semente gera os mesmos dados")
    return parser.parse_args(argv)


def main(argv=None):
    # Consoles do Windows nem sempre usam UTF-8; sem isso os acentos saem quebrados
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    argumentos = ler_argumentos(argv)
    config = ia.ler_config()
    hoje = datetime.now(ZoneInfo(config.fuso_horario)).date()

    print("=== ECOS - Gerador de dados de demonstração ===")
    if argumentos.resetar:
        print("--resetar: TODA a telemetria, anomalias, alertas e baselines serão apagados antes.")
    print()

    with conectar_banco() as conexao:
        try:
            resultado = gerar(conexao, config, hoje, datetime.now(timezone.utc), argumentos.semente, argumentos.resetar)
        except Exception:
            conexao.rollback()
            raise

        if argumentos.confirmar:
            conexao.commit()
        else:
            conexao.rollback()

    exibir(resultado, argumentos.confirmar, config.min_historico)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as erro:
        print(f"ERRO: {erro}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Interrompido: nada foi gravado.", file=sys.stderr)
        sys.exit(130)
