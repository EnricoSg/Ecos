import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { api } from '../../services/api';

const TOKEN_KEY = '@Ecos:token';

interface RespostaLogin {
    token: string;
    tipo: 'Bearer';
    expira_em: string;
}

interface RespostaErro {
    erro?: string;
}

export function Login() {
    const [usuario, setUsuario] = useState('');
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState('');
    const [enviando, setEnviando] = useState(false);

    const navigate = useNavigate();

    async function handleEntrar(evento: FormEvent<HTMLFormElement>) {
        evento.preventDefault();
        setErro('');
        setEnviando(true);

        try {
            const { data } = await api.post<RespostaLogin>('/login', { usuario, senha });
            localStorage.setItem(TOKEN_KEY, data.token);
            navigate('/dashboard', { replace: true });
        } catch (error) {
            if (axios.isAxiosError<RespostaErro>(error)) {
                setErro(
                    error.response?.data?.erro ??
                    'Não foi possível conectar à API. Verifique se o servidor está ativo.'
                );
            } else {
                setErro('Não foi possível entrar. Tente novamente.');
            }
        } finally {
            setEnviando(false);
        }
    }

    return (
        <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <section className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
                <div className="flex justify-center mb-4">
                    {/* Logo animado: a tecla é pressionada e a onda percorre o nome (parado com "reduzir movimento") */}
                    <img src="/ecos-logo-animado.svg" alt="Ecos" className="h-24 w-auto" />
                </div>

                <h1 className="text-xl font-semibold text-center text-gray-700 mb-6">Acesso do RH</h1>
                <form onSubmit={handleEntrar} className="flex flex-col gap-4">
                    <label htmlFor="usuario" className="text-sm font-medium text-gray-700">
                        Usuário do RH
                    </label>
                    <input
                        id="usuario"
                        name="usuario"
                        type="text"
                        autoComplete="username"
                        placeholder="Usuário"
                        required
                        className="border p-2 rounded"
                        value={usuario}
                        onChange={(evento) => setUsuario(evento.target.value)}
                    />

                    <label htmlFor="senha" className="text-sm font-medium text-gray-700">
                        Senha
                    </label>
                    <input
                        id="senha"
                        name="senha"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Senha"
                        required
                        className="border p-2 rounded"
                        value={senha}
                        onChange={(evento) => setSenha(evento.target.value)}
                    />

                    {erro && (
                        <p role="alert" className="text-sm text-red-700" aria-live="polite">
                            {erro}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={enviando}
                        className="bg-[#0B1F3A] text-white p-2 rounded hover:bg-[#173A63] font-bold disabled:cursor-wait disabled:opacity-60"
                    >
                        {enviando ? 'Entrando…' : 'Entrar'}
                    </button>
                </form>
            </section>
        </main>
    );
}
