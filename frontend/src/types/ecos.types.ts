//espelhando a tabela de "colaborador" do bd

export interface ColaboradorAnonimo{
    id: number;
    codigo_anonimo: string; // garante a anonimização conforme LGPD
    setor: string;
    ativo: boolean;
}

//espelho da tabela 'telemetria'
export interface Telemetria{
    id: number;
    dwell_time: number;
    flight_time: number;
    mouse_speed: number;
    data_coleta: string;
}

//espelho da tabela 'alerta'
export interface Alerta{
    id: number;
    status: 'PENDENTE' | 'RESOLVIDO';
    mensagem: string;
    data_criacao: string; // - Mensagem sem diagnóstico clinico
    data_resolucao: string | null;
    anomalia: {
        id: number;
        nivel: 'BAIXO' | 'MEDIO' | 'ALTO';
            pontuacao_desvio: number;
        data_deteccao: string;
    };
    colaborador: {
        codigo_anonimo: string;
        setor: string | null;
    };

}

export interface RespostaListaAlertas{
    total: number;
    pagina: number;
    limite: number;
    alertas: Alerta [];
}

export interface PontoTendenciaSetor {
    periodo: string;
    media_dwell_time: number | null;
    media_flight_time: number | null;
    media_mouse_speed: number | null;
    eventos: number;
    colaboradores: number;
    anomalias: number;
}

export interface BaselineTendenciaSetor{
    media_dwell_time: number | null;
    media_flight_time: number | null;
    media_mouse_speed: number | null;
}

export interface RespostaTendenciaSetor{
    setor: string;
    inicio: string;
    fim: string;
    agrupamento: 'hora' | 'dia' | 'semana';
    colaboradores: number;
    baseline: BaselineTendenciaSetor;
    serie: PontoTendenciaSetor[];
}

export interface SetorResumo {
    setor: string;
    colaboradores: number;
    alertas_pendentes: number;
}

export interface RespostaListaSetores{
    setores: SetorResumo[];
}

// GET /api/alertas/resumo - números dos cards do topo
export interface RespostaResumoAlertas {
    setor: string | null;
    pendentes: number;
    resolvidos: number;
    pendentes_alto: number;
    pendentes_medio: number;
    horas_medias_ate_resolver: number | null;
}

export interface MetricasComportamentais {
    dwell_time: number | null;
    flight_time: number | null;
    mouse_speed: number | null;
}

// GET /api/alertas/:id - alerta + janela avaliada pela IA comparada ao baseline
export interface DetalheAlerta extends Alerta {
    comparacao: {
        baseline: MetricasComportamentais & { data_calculo: string };
        observado: MetricasComportamentais & {
            eventos: number;
            janela_inicio: string;
            janela_fim: string;
        };
        variacao_percentual: MetricasComportamentais;
    };
    aviso: string;
}