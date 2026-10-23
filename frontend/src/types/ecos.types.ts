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
