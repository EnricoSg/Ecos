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
    anomalia_id: number;
    status: 'PENDENTE' | 'RESOLVIDO';
    mensagem: string; // - Mensagem sem diagnóstico clinico
    nivel_anomalia: 'BAIXO' | 'MEDIO' | 'ALTO';
}