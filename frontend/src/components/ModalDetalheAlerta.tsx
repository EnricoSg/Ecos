import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import axios from 'axios';
import { api } from '../services/api';
import type { DetalheAlerta, MetricasComportamentais } from '../types/ecos.types';

interface ModalDetalheAlertaProps {
    alertaId: number;
    aoFechar: () => void;
}

const LINHAS: { chave: keyof MetricasComportamentais; nome: string; unidade: string }[] = [
    { chave: 'dwell_time', nome: 'Tempo de pressão das teclas (dwell)', unidade: 'ms' },
    { chave: 'flight_time', nome: 'Intervalo entre teclas (flight)', unidade: 'ms' },
    { chave: 'mouse_speed', nome: 'Velocidade do mouse', unidade: 'px/s' },
];

const CORES_NIVEL = {
    ALTO: 'bg-red-100 text-red-700',
    MEDIO: 'bg-amber-100 text-amber-700',
    BAIXO: 'bg-blue-100 text-blue-700',
} as const;

function formatarNumero(valor: number | null, unidade: string) {
    return valor === null ? '—' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unidade}`;
}

function formatarVariacao(valor: number | null) {
    if (valor === null) return '—';
    const sinal = valor > 0 ? '+' : '';
    return `${sinal}${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function corVariacao(valor: number | null) {
    if (valor === null) return 'text-gray-500';
    const distancia = Math.abs(valor);
    if (distancia >= 50) return 'text-red-700';
    if (distancia >= 20) return 'text-amber-700';
    return 'text-gray-700';
}

function formatarJanela(inicio: string, fim: string) {
    const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(inicio));
    const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
    return `${data}, das ${hora.format(new Date(inicio))} às ${hora.format(new Date(fim))}`;
}

export function ModalDetalheAlerta({ alertaId, aoFechar }: ModalDetalheAlertaProps) {
    const [detalhe, setDetalhe] = useState<DetalheAlerta | null>(null);
    const [erro, setErro] = useState('');
    const botaoFecharRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const controller = new AbortController();

        async function buscarDetalhe() {
            setDetalhe(null);
            setErro('');

            try {
                const resposta = await api.get<DetalheAlerta>(`/alertas/${alertaId}`, {
                    signal: controller.signal,
                });

                setDetalhe(resposta.data);
            } catch (erro) {
                if (!controller.signal.aborted) {
                    console.error('Erro ao carregar detalhe do alerta:', erro);
                    setErro(
                        axios.isAxiosError(erro) && erro.response?.status === 404
                            ? 'Este alerta não foi encontrado.'
                            : 'Não foi possível carregar os detalhes do alerta.',
                    );
                }
            }
        }

        void buscarDetalhe();

        return () => controller.abort();
    }, [alertaId]);

    // Esc fecha o modal; o foco vai para o botão de fechar ao abrir
    useEffect(() => {
        botaoFecharRef.current?.focus();

        function aoPressionarTecla(evento: KeyboardEvent) {
            if (evento.key === 'Escape') aoFechar();
        }

        window.addEventListener('keydown', aoPressionarTecla);
        return () => window.removeEventListener('keydown', aoPressionarTecla);
    }, [aoFechar]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
            onClick={aoFechar}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="detalhe-alerta-titulo"
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg"
                onClick={(evento) => evento.stopPropagation()}
            >
                <header className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 id="detalhe-alerta-titulo" className="text-xl font-bold text-gray-800">
                            Detalhes do alerta #{alertaId}
                        </h2>
                        {detalhe && (
                            <p className="mt-1 text-sm text-gray-500">
                                {detalhe.colaborador.setor ?? 'Setor não informado'} · Colaborador{' '}
                                <span className="font-mono">{detalhe.colaborador.codigo_anonimo.slice(0, 8)}…</span>
                            </p>
                        )}
                    </div>

                    <button
                        ref={botaoFecharRef}
                        type="button"
                        onClick={aoFechar}
                        aria-label="Fechar detalhes"
                        className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                {erro ? (
                    <p role="alert" className="text-sm text-red-700">{erro}</p>
                ) : !detalhe ? (
                    <p className="text-sm text-gray-500">Carregando detalhes…</p>
                ) : (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${CORES_NIVEL[detalhe.anomalia.nivel]}`}>
                                Nível {detalhe.anomalia.nivel}
                            </span>
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                                {detalhe.status}
                            </span>
                            <span className="text-xs text-gray-500">
                                Pontuação de desvio:{' '}
                                {detalhe.anomalia.pontuacao_desvio.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                            </span>
                        </div>

                        <div>
                            <h3 className="mb-1 text-sm font-semibold text-gray-700">Mensagem da IA</h3>
                            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{detalhe.mensagem}</p>
                        </div>

                        <div>
                            <h3 className="mb-1 text-sm font-semibold text-gray-700">Janela avaliada</h3>
                            <p className="text-sm text-gray-700">
                                {formatarJanela(
                                    detalhe.comparacao.observado.janela_inicio,
                                    detalhe.comparacao.observado.janela_fim,
                                )}{' '}
                                <span className="text-gray-500">
                                    ({detalhe.comparacao.observado.eventos} eventos)
                                </span>
                            </p>
                        </div>

                        <div>
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">Comparação com o padrão do colaborador</h3>
                            <div className="overflow-x-auto rounded-lg border border-gray-200">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                        <tr>
                                            <th scope="col" className="px-3 py-2">Métrica</th>
                                            <th scope="col" className="px-3 py-2 text-right">Baseline</th>
                                            <th scope="col" className="px-3 py-2 text-right">Observado</th>
                                            <th scope="col" className="px-3 py-2 text-right">Desvio</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {LINHAS.map(({ chave, nome, unidade }) => {
                                            const variacao = detalhe.comparacao.variacao_percentual[chave];

                                            return (
                                                <tr key={chave}>
                                                    <th scope="row" className="px-3 py-2 font-medium text-gray-700">{nome}</th>
                                                    <td className="px-3 py-2 text-right text-gray-600">
                                                        {formatarNumero(detalhe.comparacao.baseline[chave], unidade)}
                                                    </td>
                                                    <td className="px-3 py-2 text-right text-gray-600">
                                                        {formatarNumero(detalhe.comparacao.observado[chave], unidade)}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-semibold ${corVariacao(variacao)}`}>
                                                        {formatarVariacao(variacao)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <p className="text-xs text-gray-500">{detalhe.aviso}</p>
                    </div>
                )}
            </section>
        </div>
    );
}
