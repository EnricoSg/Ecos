import { useState } from 'react';
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { RespostaTendenciaSetor } from '../types/ecos.types';

type ChaveMetrica = 'media_dwell_time' | 'media_flight_time' | 'media_mouse_speed';

interface Metrica {
    chave: ChaveMetrica;
    aba: string;
    nome: string;
    unidade: string;
    cor: string;
}

const METRICAS: Metrica[] = [
    { chave: 'media_dwell_time', aba: 'Dwell time', nome: 'Dwell time médio', unidade: 'ms', cor: '#2563eb' },
    { chave: 'media_flight_time', aba: 'Flight time', nome: 'Flight time médio', unidade: 'ms', cor: '#7c3aed' },
    { chave: 'media_mouse_speed', aba: 'Velocidade do mouse', nome: 'Velocidade média do mouse', unidade: 'px/s', cor: '#059669' },
];

interface GraficoTendenciasProps {
    tendencia: RespostaTendenciaSetor;
}

export function GraficoTendencias({ tendencia }: GraficoTendenciasProps) {
    const [chaveAtiva, setChaveAtiva] = useState<ChaveMetrica>('media_dwell_time');
    const metrica = METRICAS.find((item) => item.chave === chaveAtiva) ?? METRICAS[0];

    const dadosGrafico = tendencia.serie
        .map((ponto) => ({
            periodo: ponto.periodo,
            valor: ponto[metrica.chave],
            baseline: tendencia.baseline[metrica.chave],
        }))
        .sort((a, b) => Date.parse(a.periodo) - Date.parse(b.periodo));

    const temDadosDaMetrica = dadosGrafico.some(
            (ponto) => typeof ponto.valor === 'number',
        );

    const formatarValor = (valor: unknown) =>
        typeof valor === 'number'
            ? `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${metrica.unidade}`
            : '—';

    return (
        <div className="flex h-full w-full flex-col">
            <div role="tablist" aria-label="Métrica exibida" className="mb-3 flex flex-wrap gap-2">
                {METRICAS.map((item) => {
                    const ativa = item.chave === chaveAtiva;

                    return (
                        <button
                            key={item.chave}
                            type="button"
                            role="tab"
                            aria-selected={ativa}
                            onClick={() => setChaveAtiva(item.chave)}
                            className={
                                ativa
                                    ? 'rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white'
                                    : 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50'
                            }
                        >
                            {item.aba}
                        </button>
                    );
                })}
            </div>

            {dadosGrafico.length === 0 || !temDadosDaMetrica ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Sem dados de telemetria no período.
                </div>
            ) : (
                <div role="tabpanel" className="min-h-0 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dadosGrafico}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="periodo"
                                tickFormatter={(valor) =>
                                    new Date(String(valor)).toLocaleDateString('pt-BR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                    })
                                }
                            />
                            <YAxis unit={` ${metrica.unidade}`} width={80} />
                            <Tooltip
                                labelFormatter={(valor) => new Date(String(valor)).toLocaleDateString('pt-BR')}
                                formatter={(valor) => formatarValor(valor)}
                            />
                            <Legend />
                            <Line
                                type="monotone"
                                dataKey="valor"
                                name={metrica.nome}
                                stroke={metrica.cor}
                                connectNulls={false}
                            />
                            <Line
                                type="monotone"
                                dataKey="baseline"
                                name="Baseline"
                                stroke="#f59e0b"
                                strokeDasharray="5 5"
                                dot={{ r: 4 }}
                                strokeWidth={3}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
