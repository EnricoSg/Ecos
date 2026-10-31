import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../services/api';
import type { RespostaResumoAlertas } from '../types/ecos.types';

interface CardsResumoProps {
    // Mudar este número força uma nova busca (ex.: depois de resolver um alerta)
    versao: number;
}

interface Card {
    titulo: string;
    valor: string;
    detalhe?: string;
    icone: LucideIcon;
    cor: string;
}

function montarCards(resumo: RespostaResumoAlertas): Card[] {
    const horas = resumo.horas_medias_ate_resolver;

    return [
        {
            titulo: 'Alertas pendentes',
            valor: String(resumo.pendentes),
            detalhe: 'Aguardando acompanhamento',
            icone: Bell,
            cor: 'bg-blue-50 text-blue-600',
        },
        {
            titulo: 'Nível alto',
            valor: String(resumo.pendentes_alto),
            detalhe: 'Pendentes com desvio alto',
            icone: AlertTriangle,
            cor: 'bg-red-50 text-red-600',
        },
        {
            titulo: 'Nível médio',
            valor: String(resumo.pendentes_medio),
            detalhe: 'Pendentes com desvio médio',
            icone: AlertTriangle,
            cor: 'bg-amber-50 text-amber-600',
        },
        {
            titulo: 'Resolvidos',
            valor: String(resumo.resolvidos),
            detalhe: horas === null ? 'Sem histórico de resolução' : `Média de ${horas.toLocaleString('pt-BR')} h até resolver`,
            icone: horas === null ? CheckCircle2 : Clock,
            cor: 'bg-green-50 text-green-600',
        },
    ];
}

export function CardsResumo({ versao }: CardsResumoProps) {
    const [resumo, setResumo] = useState<RespostaResumoAlertas | null>(null);
    const [erro, setErro] = useState('');

    useEffect(() => {
        const controller = new AbortController();

        async function buscarResumo() {
            setErro('');

            try {
                const resposta = await api.get<RespostaResumoAlertas>('/alertas/resumo', {
                    signal: controller.signal,
                });

                setResumo(resposta.data);
            } catch (erro) {
                if (!controller.signal.aborted) {
                    console.error('Erro ao carregar resumo:', erro);
                    setErro('Não foi possível carregar o resumo dos alertas.');
                }
            }
        }

        void buscarResumo();

        return () => controller.abort();
    }, [versao]);

    if (erro && !resumo) {
        return (
            <p role="alert" className="mb-6 rounded-xl border border-red-100 bg-white p-4 text-sm text-red-700 shadow-sm">
                {erro}
            </p>
        );
    }

    return (
        <section aria-label="Resumo dos alertas" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {resumo
                ? montarCards(resumo).map(({ titulo, valor, detalhe, icone: Icone, cor }) => (
                      <article key={titulo} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                          <div className="flex items-center justify-between">
                              <h2 className="text-sm font-medium text-gray-500">{titulo}</h2>
                              <span className={`rounded-lg p-2 ${cor}`}>
                                  <Icone size={18} aria-hidden="true" />
                              </span>
                          </div>
                          <p className="mt-2 text-3xl font-bold text-gray-800">{valor}</p>
                          {detalhe && <p className="mt-1 text-xs text-gray-500">{detalhe}</p>}
                      </article>
                  ))
                : Array.from({ length: 4 }, (_, indice) => (
                      <div
                          key={indice}
                          aria-hidden="true"
                          className="h-[118px] animate-pulse rounded-xl border border-gray-100 bg-white shadow-sm"
                      />
                  ))}
        </section>
    );
}
