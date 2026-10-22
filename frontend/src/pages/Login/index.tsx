import { useState} from 'react';
import { Lock } from 'lucide-react';
import { useNavigate} from 'react-router-dom';

export function Login() {
    const [email, setEmail] = useState('');
    const [senha, setSenha] = useState('');

    const navigate = useNavigate();

    //funcao do botao "entrar"
    function handleEntrar(evento: React.FormEvent) {
        evento.preventDefault();
        navigate('/dashboard');
    }

    return (
     <div className="min-h-screen bg-gray-50 flex items-center justify-center">

            <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
                <div className="flex justify-center mb-6">
                    <Lock className="w-12 h-12 text-blue-600" />
                </div>

                <h1 className="text-2xl font-bold text-center mb-6">Acesso Ecos (RH)</h1>
                <form onSubmit={handleEntrar} className="flex flex-col gap-4">
                 <input
                        type="email"
                        placeholder="E-mail Institucional"
                        className="border p-2 rounded"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)} //atualiza a variavel email
                    />

                    <input
                        type="password"
                        placeholder="Senha"
                        className="border p-2 rounded"
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)} //atualiza a variavel senha
                    />

                    <button
                        type="submit"
                        className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 font-bold"
                    >
                        Entrar
                    </button>
                </form>
            </div>
        </div>
    );
}