import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import type { Alerta, RespostaListaAlertas } from '../../types/ecos.types';

const TOKEN_KEY = '@Ecos:token';

export function Dashboard() {
    const navigate = useNavigate();
    const [alertas, setAlertas] = useState<Alerta[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState('');
    const [resolvendoId, setResolvendoId] = useState<number | null>(null);
    const [erroAcao, setErroAcao] = useState('');

    useEffect(() => {
        const controller = new AbortController();

        async function buscarAlertas() {
            try {
                const resposta = await api.get<RespostaListaAlertas>('/alertas', {
                    params: { status: 'PENDENTE', limite: 10 },
                    signal: controller.signal,
                });

                setAlertas(resposta.data.alertas);
            } catch {
                if (!controller.signal.aborted) {
                    setErro('Não foi possível carregar os alertas. Tente novamente.');
                }
            } finally {
                if (!controller.signal.aborted) {
                    setCarregando(false);
                }
            }
        }

        void buscarAlertas();

        return () => controller.abort();
    }, []);

    function handleSair() {
        localStorage.removeItem(TOKEN_KEY);
        navigate('/login', { replace: true });
    }

    async function handleResolver(id: number) {
        setResolvendoId(id);
        setErroAcao('');

        try {
            await api.patch(`/alertas/${id}`, {status: 'RESOLVIDO'});

            setAlertas((listaAtual) =>
                listaAtual.filter((alerta) => alerta.id !== id)
            );
        }catch {
            setErroAcao('Não foi possível resolver este alerta. Tente novamente.');
        }finally {
            setResolvendoId(null);
        }
    }

    return (
        <main className="min-h-screen bg-gray-100 p-8">
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Visão Geral - Ecos</h1>
                    <p className="mt-1 text-gray-500">Monitoramento de anomalias comportamentais</p>
                </div>

                <button
                    type="button"
                    onClick={handleSair}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <LogOut size={18} aria-hidden="true" />
                    Sair
                </button>
            </header>

            <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:col-span-2">
                    <h2 className="mb-4 text-lg font-semibold text-gray-700">Tendências</h2>
                    <div className="flex h-64 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                        <span className="text-gray-400">Gráfico de tendências será exibido aqui</span>
                    </div>
                </div>

                <section
                    className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
                    aria-labelledby="alertas-titulo"
                >
                    <h2 id="alertas-titulo" className="mb-4 text-lg font-semibold text-gray-700">
                        Alertas pendentes
                    </h2>

                    <div className="space-y-3" aria-live="polite">
                        {erroAcao && (
                            <p role='alert' className = "text-sm text-red-700">
                                {erroAcao}
                            </p>
                        )}
                        {carregando ? (
                            <p className="text-sm text-gray-500">Carregando alertas…</p>
                        ) : erro ? (
                            <p role="alert" className="text-sm text-red-700">{erro}</p>
                        ) : alertas.length === 0 ? (
                            <p className="text-sm text-gray-500">Nenhum alerta pendente.</p>
                        ) : (
                            alertas.map((alerta) => (
                                <article key={alerta.id} className="rounded-lg border border-gray-200 p-4">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <strong className="text-sm text-gray-800">
                                            Nível {alerta.anomalia.nivel}
                                        </strong>
                                        <span className="text-xs text-gray-500">
                                            {alerta.colaborador.setor ?? 'Setor não informado'}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700">{alerta.mensagem}</p>
                                    <time
                                        className="mt-2 block text-xs text-gray-500"
                                        dateTime={alerta.anomalia.data_deteccao}
                                    >
                                        {new Intl.DateTimeFormat('pt-BR', {
                                            dateStyle: 'short',
                                            timeStyle: 'short',
                                        }).format(new Date(alerta.anomalia.data_deteccao))}
                                    </time>
                                    <button
                                    type="button"
                                    onClick={() => void handleResolver(alerta.id)}
                                    disabled={resolvendoId !== null}
                                    >
                                        {resolvendoId === alerta.id ? 'Resolvendo...' : 'Resolver'}
                                    </button>
                                </article>
                            ))
                        )}
                    </div>
                </section>
            </section>
        </main>
    );
}
