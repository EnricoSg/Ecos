const path = require('path');
const { lerArgumentos, caminhoPython, verificarPrerequisitos, resumirSaidaIa } = require('../scripts/iniciar');

const RAIZ = path.join('C:', 'ecos');

describe('Comando único (scripts/iniciar.js): argumentos', () => {
    test('padrão: captura real, perfil normal, IA a cada 5 min, com coletor e Dashboard', () => {
        expect(lerArgumentos([])).toEqual({
            opcoes: { modo: 'real', perfil: 'normal', intervaloIaMin: 5, coletor: true, front: true, duracaoSeg: 0 },
            erros: []
        });
    });

    test('lê todas as opções', () => {
        const { opcoes, erros } = lerArgumentos([
            '--modo=simulado', '--perfil=fadiga', '--intervalo-ia=2', '--sem-coletor', '--sem-front', '--duracao=30'
        ]);

        expect(erros).toEqual([]);
        expect(opcoes).toEqual({ modo: 'simulado', perfil: 'fadiga', intervaloIaMin: 2, coletor: false, front: false, duracaoSeg: 30 });
    });

    test('aponta opções inválidas ou desconhecidas', () => {
        const { erros } = lerArgumentos(['--modo=teclado', '--perfil=cansado', '--intervalo-ia=0', '--duracao=abc', '--porta=1']);

        expect(erros).toHaveLength(5);
        expect(erros).toContain('Opção desconhecida: --porta=1');
    });
});

describe('Comando único: Python da IA', () => {
    test('usa o Python do .venv quando ele existe', () => {
        expect(caminhoPython(RAIZ, 'win32', () => true)).toBe(path.join(RAIZ, '.venv', 'Scripts', 'python.exe'));
        expect(caminhoPython(RAIZ, 'linux', () => true)).toBe(path.join(RAIZ, '.venv', 'bin', 'python'));
    });

    test('sem .venv, cai para o Python do sistema', () => {
        expect(caminhoPython(RAIZ, 'win32', () => false)).toBe('python');
        expect(caminhoPython(RAIZ, 'darwin', () => false)).toBe('python3');
    });
});

describe('Comando único: saída da IA no terminal', () => {
    const cabecalho = [
        '=== ECOS - Detecção de Anomalias (PostgreSQL) ===',
        'Janelas de 15 min | mínimo de 30 eventos por janela | limiares 1.25/1.75/2.5',
        '',
        '=== RESUMO ==='
    ];

    test('execução sem eventos novos vira uma linha só', () => {
        // Saída real do pipeline.py quando não há nada pendente
        const saida = [
            ...cabecalho,
            'Eventos lidos: 0',
            'Janelas: 0 | avaliadas: 0 | em calibração: 0 | amostra insuficiente: 0',
            'Anomalias: 0 (BAIXO 0, MEDIO 0, ALTO 0)',
            'Alertas criados: 0',
            'Baselines criados: 0'
        ];
        expect(resumirSaidaIa(saida)).toEqual([expect.stringContaining('Nada novo para analisar')]);
    });

    test('baseline novo criado nunca é escondido', () => {
        const saida = [...cabecalho, 'Eventos lidos: 0', '  Baseline 12 criado para o colaborador 1 (240 eventos de histórico).'];
        expect(resumirSaidaIa(saida)).toContain('Baseline 12 criado para o colaborador 1 (240 eventos de histórico).');
    });

    test('execução com resultado mostra tudo, menos o cabeçalho repetido', () => {
        const saida = [
            ...cabecalho.slice(0, 2),
            '  [ALTO ] colaborador 1, janela 07/11 16:00: pontuação 3.10',
            '=== RESUMO ===',
            'Eventos lidos: 45',
            'Alertas criados: 1'
        ];

        expect(resumirSaidaIa(saida)).toEqual([
            '[ALTO ] colaborador 1, janela 07/11 16:00: pontuação 3.10',
            'Eventos lidos: 45',
            'Alertas criados: 1'
        ]);
    });

    test('progresso da calibração nunca é escondido', () => {
        const saida = [...cabecalho, 'Eventos lidos: 0', 'Calibração do colaborador 1: 143/200 eventos de histórico (ainda sem alertas)'];
        expect(resumirSaidaIa(saida)).toContain('Calibração do colaborador 1: 143/200 eventos de histórico (ainda sem alertas)');
    });
});

describe('Comando único: pré-requisitos', () => {
    const faltandoTudo = () => false;

    test('tudo instalado e configurado: nada falta', () => {
        expect(verificarPrerequisitos(lerArgumentos([]).opcoes, RAIZ, () => true)).toEqual([]);
    });

    test('lista cada .env e dependência ausente, com a dica de como resolver', () => {
        const faltando = verificarPrerequisitos(lerArgumentos([]).opcoes, RAIZ, faltandoTudo);

        expect(faltando).toHaveLength(6);
        expect(faltando[0]).toMatch(/api\/\.env não encontrado: copie api\/\.env\.example/);
        expect(faltando.some((item) => item.includes('uiohook-napi'))).toBe(true);
    });

    test('o simulador não exige o módulo nativo de captura', () => {
        const faltando = verificarPrerequisitos(lerArgumentos(['--modo=simulado']).opcoes, RAIZ, faltandoTudo);
        expect(faltando.some((item) => item.includes('uiohook-napi'))).toBe(false);
    });

    test('sem coletor e sem Dashboard, só API e IA são exigidas', () => {
        const faltando = verificarPrerequisitos(lerArgumentos(['--sem-coletor', '--sem-front']).opcoes, RAIZ, faltandoTudo);
        expect(faltando.map((item) => item.split(' ')[0])).toEqual(['api/.env', 'api/node_modules', 'ai/.env']);
    });
});
