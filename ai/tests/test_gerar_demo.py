import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pytest

from anomaly_detector import Config
from gerar_demo import (
    COLABORADOR_SIMULADOR,
    DIAS_RECENTES,
    EPISODIOS,
    FADIGA,
    NORMAL,
    SETORES,
    SINTETICOS_POR_SETOR,
    TARDE,
    codigo_sintetico,
    dias_uteis,
    gerar,
    gerar_eventos,
    janelas_do_periodo,
    perfil,
)
from test_anomaly_detector import conectar_ou_pular

FUSO = ZoneInfo("America/Sao_Paulo")


# =====================================================
# Simulação das métricas
# =====================================================

def test_perfil_vai_do_normal_a_fadiga_do_simulador():
    for chave in NORMAL:
        assert perfil(0)[chave] == pytest.approx(NORMAL[chave])
        assert perfil(1)[chave] == pytest.approx(FADIGA[chave])


def test_eventos_sao_inteiros_dentro_dos_limites():
    rng = np.random.default_rng(1)

    for intensidade in (0, 1, 2):
        eventos = gerar_eventos(rng, 5000, intensidade)
        p = perfil(intensidade)

        assert all(np.issubdtype(valores.dtype, np.integer) for valores in eventos.values())
        assert eventos["dwell_time"].min() >= round(p["dwell"][2]) and eventos["dwell_time"].max() <= round(p["dwell"][3])
        assert eventos["flight_time"].min() >= round(p["flight"][2])
        assert eventos["mouse_speed"].min() >= 0


def test_fadiga_deixa_a_digitacao_e_o_mouse_mais_lentos():
    rng = np.random.default_rng(2)
    normal = gerar_eventos(rng, 5000, 0)
    fadiga = gerar_eventos(rng, 5000, 1)

    assert np.median(fadiga["dwell_time"]) > 1.2 * np.median(normal["dwell_time"])
    assert np.median(fadiga["flight_time"]) > 1.5 * np.median(normal["flight_time"])
    assert np.median(fadiga["mouse_speed"]) < np.median(normal["mouse_speed"])


# =====================================================
# Calendário e roteiro
# =====================================================

def test_dias_uteis_sem_fim_de_semana_e_sem_o_dia_de_hoje():
    dias = dias_uteis(date(2026, 11, 7), 28)  # sábado

    assert all(dia.weekday() < 5 for dia in dias)
    assert dias[0] == date(2026, 10, 12)
    assert dias[-1] == date(2026, 11, 6)
    assert len(dias) == 20


def test_janelas_alinhadas_como_na_ia_e_dentro_do_expediente():
    janelas = janelas_do_periodo(date(2026, 11, 6), TARDE, 15, FUSO)

    assert janelas[0] == datetime(2026, 11, 6, 13, 30, tzinfo=FUSO)
    assert janelas[-1] + timedelta(minutes=15) <= datetime(2026, 11, 6, 18, 0, tzinfo=FUSO)
    assert all(int(janela.timestamp()) % 900 == 0 for janela in janelas)
    assert len(janelas) == 18


def test_codigo_sintetico_e_deterministico_e_no_formato_do_coletor():
    codigo = codigo_sintetico("Financeiro", 1)

    assert codigo == codigo_sintetico("Financeiro", 1)
    assert codigo != codigo_sintetico("Financeiro", 2)
    assert re.fullmatch(r"[a-f0-9]{32}", codigo)


def test_episodios_apontam_para_colaboradores_e_dias_que_existem():
    for episodio in EPISODIOS:
        assert episodio.setor in SETORES
        assert 0 <= episodio.indice < SINTETICOS_POR_SETOR
        assert 0 <= episodio.dia < DIAS_RECENTES
        # O colaborador do simulador fica com o padrão exato do coletor, sem episódios
        assert (episodio.setor, episodio.indice) != COLABORADOR_SIMULADOR


# =====================================================
# Roteiro completo no PostgreSQL real (transação desfeita no final)
# =====================================================

def test_roteiro_completo_gera_os_alertas_planejados():
    conexao = conectar_ou_pular()
    hoje = datetime.now(FUSO).date()

    try:
        resultado = gerar(conexao, Config(), hoje, datetime.now(timezone.utc), semente=2026, resetar=False)
        alertas = {(linha["setor"], linha["status"], linha["nivel"]): linha["quantidade"] for linha in resultado["alertas"]}

        def total(setor, status):
            return sum(q for (s, st, _), q in alertas.items() if s == setor and st == status)

        # Fechamento do mês: o Financeiro concentra os alertas pendentes, com pelo menos um ALTO
        assert total("Financeiro", "PENDENTE") >= 3
        assert alertas.get(("Financeiro", "PENDENTE", "ALTO"), 0) >= 1
        # RH só teve episódios no início da semana, já resolvidos
        assert total("Recursos Humanos", "PENDENTE") == 0
        assert total("Recursos Humanos", "RESOLVIDO") >= 1

        # Todos os sintéticos saíram da calibração com baseline, e todo setor respeita a regra de privacidade
        assert resultado["baselines"] >= len(SETORES) * SINTETICOS_POR_SETOR
        assert all(linha["ativos"] >= 5 for linha in resultado["setores"] if linha["setor"] in SETORES)

        simulador = next(c for c in resultado["colaboradores"] if (c.setor, c.indice) == COLABORADOR_SIMULADOR)
        with conexao.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM anomalia WHERE colaborador_id = %s AND nivel <> 'BAIXO'", (simulador.id,))
            assert cursor.fetchone()[0] == 0, "o colaborador do simulador só tem comportamento normal"
    finally:
        conexao.rollback()
        conexao.close()
