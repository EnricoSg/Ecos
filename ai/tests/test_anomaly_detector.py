from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from anomaly_detector import (
    METRICAS,
    Config,
    agrupar_em_janelas,
    calcular_corte,
    criar_mensagem,
    definir_nivel,
    escala_robusta,
    ler_config,
    media_aparada,
    pontuar_janela,
    processar,
)


# Distribuições equivalentes às do simulador do coletor (coletor/index.js)
PERFIS = {
    "normal": {"dwell": (95, 0.22), "flight": (85, 0.35), "pausa": 0.04, "mouse": (480, 110)},
    "fadiga": {"dwell": (135, 0.32), "flight": (160, 0.45), "pausa": 0.10, "mouse": (320, 120)},
}


def gerar_eventos(perfil: str, quantidade: int, semente: int) -> pd.DataFrame:
    p = PERFIS[perfil]
    rng = np.random.default_rng(semente)
    flight = p["flight"][0] * np.exp(p["flight"][1] * rng.standard_normal(quantidade))
    flight += (rng.random(quantidade) < p["pausa"]) * rng.uniform(500, 2500, quantidade)

    return pd.DataFrame({
        "dwell_time": np.round(p["dwell"][0] * np.exp(p["dwell"][1] * rng.standard_normal(quantidade))),
        "flight_time": np.round(flight),
        "mouse_speed": np.round(np.clip(p["mouse"][0] + p["mouse"][1] * rng.standard_normal(quantidade), 50, 1500)),
    })


def referencia(historico: pd.DataFrame):
    centro = {m: media_aparada(historico[m]) for m in METRICAS}
    escala = {m: escala_robusta(np.median(np.abs(historico[m] - historico[m].median())), centro[m]) for m in METRICAS}
    return centro, escala


# =====================================================
# Estatística
# =====================================================

class TestMediaAparada:
    def test_ignora_pausas_longas(self):
        valores = [100] * 18 + [3000, 2500]
        assert media_aparada(valores) == pytest.approx(100)
        assert np.mean(valores) > 300

    def test_sem_outliers_igual_a_media(self):
        assert media_aparada(list(range(1, 101))) == pytest.approx(50.5, abs=0.5)


class TestEscalaRobusta:
    def test_converte_mad_para_desvio_padrao(self):
        assert escala_robusta(10, 100) == pytest.approx(14.826)

    def test_piso_de_5_por_cento_do_baseline(self):
        assert escala_robusta(0, 400) == pytest.approx(20)

    def test_piso_absoluto_de_1(self):
        assert escala_robusta(0, 0) == 1.0


class TestNivel:
    @pytest.mark.parametrize("pontuacao, esperado", [
        (0.0, None), (1.24, None), (1.25, "BAIXO"), (1.74, "BAIXO"),
        (1.75, "MEDIO"), (2.49, "MEDIO"), (2.5, "ALTO"), (40, "ALTO"),
    ])
    def test_limiares_padrao(self, pontuacao, esperado):
        assert definir_nivel(pontuacao, Config()) == esperado


class TestPontuacao:
    def test_janela_identica_ao_baseline_tem_pontuacao_zero(self):
        janela = pd.DataFrame({"dwell_time": [100] * 40, "flight_time": [80] * 40, "mouse_speed": [500] * 40})
        centro = {"dwell_time": 100, "flight_time": 80, "mouse_speed": 500}
        escala = {"dwell_time": 20, "flight_time": 30, "mouse_speed": 100}

        resultado = pontuar_janela(janela, centro, escala, 0.1)

        assert resultado["pontuacao"] == 0

    def test_pontuacao_e_a_raiz_da_media_dos_z_ao_quadrado(self):
        janela = pd.DataFrame({"dwell_time": [140] * 40, "flight_time": [80] * 40, "mouse_speed": [500] * 40})
        centro = {"dwell_time": 100, "flight_time": 80, "mouse_speed": 500}
        escala = {"dwell_time": 20, "flight_time": 30, "mouse_speed": 100}

        resultado = pontuar_janela(janela, centro, escala, 0.1)

        assert resultado["z"]["dwell_time"] == pytest.approx(2.0)
        assert resultado["variacoes"]["dwell_time"] == pytest.approx(0.4)
        assert resultado["pontuacao"] == pytest.approx(np.sqrt(4 / 3), abs=1e-6)

    def test_comportamento_normal_nao_gera_alerta(self):
        centro, escala = referencia(gerar_eventos("normal", 3000, semente=1))
        niveis = [
            definir_nivel(pontuar_janela(gerar_eventos("normal", 60, semente=100 + i), centro, escala, 0.1)["pontuacao"], Config())
            for i in range(300)
        ]

        assert niveis.count("MEDIO") + niveis.count("ALTO") == 0
        assert niveis.count(None) >= 295

    def test_fadiga_gera_alerta(self):
        centro, escala = referencia(gerar_eventos("normal", 3000, semente=1))
        niveis = [
            definir_nivel(pontuar_janela(gerar_eventos("fadiga", 60, semente=500 + i), centro, escala, 0.1)["pontuacao"], Config())
            for i in range(300)
        ]

        # Sensibilidade mínima de 98%, e nenhuma janela de fadiga passa como normal
        assert niveis.count("MEDIO") + niveis.count("ALTO") >= 294
        assert None not in niveis

    def test_uma_pausa_isolada_nao_gera_anomalia(self):
        centro, escala = referencia(gerar_eventos("normal", 3000, semente=1))
        janela = gerar_eventos("normal", 60, semente=7)
        janela.loc[0, "flight_time"] = 4000

        assert definir_nivel(pontuar_janela(janela, centro, escala, 0.1)["pontuacao"], Config()) is None


# =====================================================
# Janelas, mensagens e configuração
# =====================================================

def test_agrupa_eventos_em_janelas_alinhadas_ao_relogio():
    eventos = pd.DataFrame({
        "data_coleta": ["2026-10-12T14:00:05Z", "2026-10-12T14:14:59Z", "2026-10-12T14:15:00Z"],
        "dwell_time": [1, 2, 3], "flight_time": [1, 2, 3], "mouse_speed": [1, 2, 3],
    })

    janelas = agrupar_em_janelas(eventos, 15)["janela"].dt.strftime("%H:%M").tolist()

    assert janelas == ["14:00", "14:00", "14:15"]


def test_corte_exclui_a_janela_em_andamento():
    agora = datetime(2026, 10, 12, 14, 7, tzinfo=timezone.utc)

    assert calcular_corte(agora, Config(), False) == datetime(2026, 10, 12, 14, 0, tzinfo=timezone.utc)
    assert calcular_corte(agora, Config(), True) > agora


def test_mensagem_do_alerta_cita_periodo_local_e_metricas():
    resultado = {
        "z": {"dwell_time": 2.0, "flight_time": 3.0, "mouse_speed": -0.5},
        "variacoes": {"dwell_time": 0.42, "flight_time": 0.88, "mouse_speed": -0.05},
    }
    inicio = datetime(2026, 10, 12, 17, 0, tzinfo=timezone.utc)

    mensagem = criar_mensagem("ALTO", resultado, inicio, inicio + timedelta(minutes=15), ZoneInfo("America/Sao_Paulo"))

    assert mensagem.startswith("Desvio alto em 12/10 das 14:00 às 14:15")
    assert "intervalo entre teclas +88%" in mensagem
    assert "tempo de pressão das teclas +42%" in mensagem
    assert "velocidade do mouse" not in mensagem
    assert len(mensagem) <= 255


def test_configuracao_pelo_env():
    config = ler_config({"IA_JANELA_MINUTOS": "5", "IA_LIMIAR_ALTO": "3", "IA_MIN_HISTORICO": "abc"})

    assert config.janela_minutos == 5
    assert config.limiar_alto == 3.0
    assert config.min_historico == 200


def test_limiares_fora_de_ordem_sao_rejeitados():
    with pytest.raises(ValueError):
        ler_config({"IA_LIMIAR_MEDIO": "5"})


# =====================================================
# Integração com o PostgreSQL real (transação desfeita no final)
# =====================================================

def conectar_ou_pular():
    try:
        from banco import conectar_banco
        conexao = conectar_banco()
    except Exception as erro:  # banco indisponível ou .env ausente
        pytest.skip(f"PostgreSQL indisponível: {erro}")

    with conexao.cursor() as cursor:
        cursor.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'telemetria' AND column_name = 'analisada_em'")
        if cursor.fetchone() is None:
            conexao.close()
            pytest.skip("Migração 001 não aplicada")

    return conexao


def inserir_eventos(cursor, colaborador_id, eventos: pd.DataFrame, inicio: datetime, analisada: bool):
    intervalo = timedelta(seconds=10)
    for i, linha in enumerate(eventos.itertuples()):
        cursor.execute(
            """
            INSERT INTO telemetria (colaborador_id, dwell_time, flight_time, mouse_speed, data_coleta, analisada_em)
            VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END)
            """,
            (colaborador_id, int(linha.dwell_time), int(linha.flight_time), int(linha.mouse_speed), inicio + i * intervalo, analisada),
        )


def test_integracao_ponta_a_ponta_no_postgresql():
    conexao = conectar_ou_pular()
    agora = datetime.now(timezone.utc)
    hora = agora.replace(minute=0, second=0, microsecond=0)

    try:
        with conexao.cursor() as cursor:
            cursor.execute("INSERT INTO colaborador (codigo_anonimo, setor) VALUES (%s, 'Teste IA') RETURNING id", ("ab" * 16 + "test",))
            colaborador_id = cursor.fetchone()[0]

            historico = gerar_eventos("normal", 600, semente=1)
            centro, _ = referencia(historico)
            cursor.execute(
                "INSERT INTO baseline (colaborador_id, media_dwell_time, media_flight_time, media_mouse_speed) VALUES (%s, %s, %s, %s) RETURNING id",
                (colaborador_id, centro["dwell_time"], centro["flight_time"], centro["mouse_speed"]),
            )
            baseline_id = cursor.fetchone()[0]

            inserir_eventos(cursor, colaborador_id, historico, hora - timedelta(days=2), analisada=True)
            # Pendentes: uma janela normal, uma de fadiga, uma com poucos eventos e uma ainda em andamento
            inserir_eventos(cursor, colaborador_id, gerar_eventos("normal", 60, semente=2), hora - timedelta(hours=3), analisada=False)
            inserir_eventos(cursor, colaborador_id, gerar_eventos("fadiga", 60, semente=3), hora - timedelta(hours=2), analisada=False)
            inserir_eventos(cursor, colaborador_id, gerar_eventos("normal", 5, semente=4), hora - timedelta(hours=1), analisada=False)
            inserir_eventos(cursor, colaborador_id, gerar_eventos("fadiga", 40, semente=5), agora.replace(second=0, microsecond=0), analisada=False)

        config = Config(janela_minutos=15)
        processar(conexao, config, agora=agora)

        with conexao.cursor() as cursor:
            cursor.execute(
                "SELECT a.nivel, a.pontuacao_desvio, a.baseline_id, al.status, al.mensagem "
                "FROM anomalia a LEFT JOIN alerta al ON al.anomalia_id = a.id WHERE a.colaborador_id = %s",
                (colaborador_id,),
            )
            anomalias = cursor.fetchall()

            cursor.execute(
                "SELECT count(*) FILTER (WHERE analisada_em IS NULL), count(*) FROM telemetria WHERE colaborador_id = %s",
                (colaborador_id,),
            )
            pendentes, total = cursor.fetchone()

        assert len(anomalias) == 1, "só a janela de fadiga deve virar anomalia"
        nivel, pontuacao, baseline_usado, status, mensagem = anomalias[0]
        assert nivel in ("MEDIO", "ALTO")
        assert float(pontuacao) >= config.limiar_medio
        assert baseline_usado == baseline_id
        assert status == "PENDENTE"
        assert "em relação ao padrão do colaborador" in mensagem

        # A janela em andamento (40 eventos) continua pendente para a próxima execução
        assert pendentes == 40
        assert total == 600 + 60 + 60 + 5 + 40

        # Segunda execução não reprocessa nada
        resumo = processar(conexao, config, agora=agora)
        with conexao.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM anomalia WHERE colaborador_id = %s", (colaborador_id,))
            assert cursor.fetchone()[0] == 1
        assert resumo.janelas == 0 or resumo.avaliadas == 0
    finally:
        conexao.rollback()
        conexao.close()
