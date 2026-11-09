import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface LimiteDeErroProps {
    fallback: ReactNode;
    children: ReactNode;
}

interface LimiteDeErroEstado {
    erro: boolean;
}

// Um erro de renderização dentro deste bloco mostra o `fallback` em vez de derrubar
// a página inteira (tela branca). Só componentes de classe conseguem fazer isso no React.
export class LimiteDeErro extends Component<LimiteDeErroProps, LimiteDeErroEstado> {
    state: LimiteDeErroEstado = { erro: false };

    static getDerivedStateFromError(): LimiteDeErroEstado {
        return { erro: true };
    }

    componentDidCatch(erro: Error, info: ErrorInfo) {
        console.error('Erro de renderização:', erro, info.componentStack);
    }

    render() {
        return this.state.erro ? this.props.fallback : this.props.children;
    }
}
