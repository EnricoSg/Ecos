const path = require('path');
const { validarTelemetria, CAMPOS_PERMITIDOS } = require('../src/validador');

const USER_ID = '4f9b8c7d6e5a4b3c2d1e0f9a8b7c6d5e';

function pacoteBase(extra = {}) {
    return {
        userId: USER_ID,
        timestamp: 1705432000000,
        dwellTime: 85,
        flightTime: 120,
        mouseSpeed: 350,
        ...extra
    };
}

// Silencia os logs do validador durante os testes
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Telemetria válida (metadados matemáticos)', () => {
    test('aprova ritmo de digitação, pausas e velocidade do rato', () => {
        const resultado = validarTelemetria(pacoteBase());

        expect(resultado.sucesso).toBe(true);
        expect(resultado.dados).toEqual({
            id_usuario: USER_ID,
            data_evento: '2024-01-16T19:06:40.000Z',
            tempo_pressao_ms: 85,
            tempo_voo_ms: 120,
            velocidade_rato_px: 350
        });
    });

    test('aceita zero (ex.: rato parado)', () => {
        const resultado = validarTelemetria(pacoteBase({ mouseSpeed: 0 }));

        expect(resultado.sucesso).toBe(true);
        expect(resultado.dados.velocidade_rato_px).toBe(0);
    });

    test('aceita hash SHA-256 (64 caracteres hexadecimais) como userId', () => {
        expect(validarTelemetria(pacoteBase({ userId: 'a'.repeat(64) })).sucesso).toBe(true);
    });

    test('aprova pacotes nos perfis normal e de fadiga do gerador de mock', () => {
        const normal = pacoteBase({ dwellTime: 50, flightTime: 50, mouseSpeed: 699 });
        const fadiga = pacoteBase({ dwellTime: 499, flightTime: 1199, mouseSpeed: 10 });

        expect(validarTelemetria(normal).sucesso).toBe(true);
        expect(validarTelemetria(fadiga).sucesso).toBe(true);
    });

    test('aprova todos os registos do telemetria-mock.json usado pelo módulo de IA', () => {
        const registos = require(path.join(__dirname, '..', 'telemetria-mock.json'));
        const rejeitados = registos.filter(registo => !validarTelemetria(registo).sucesso);

        expect(registos.length).toBeGreaterThan(0);
        expect(rejeitados).toEqual([]);
    });

    test('os dados limpos contêm apenas números, ISO date e o hash (sem texto livre)', () => {
        const { dados } = validarTelemetria(pacoteBase());

        expect(Object.keys(dados).sort()).toEqual(
            ['data_evento', 'id_usuario', 'tempo_pressao_ms', 'tempo_voo_ms', 'velocidade_rato_px']
        );
        expect(dados.id_usuario).toMatch(/^[a-f0-9]+$/i);
        expect(dados.data_evento).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(typeof dados.tempo_pressao_ms).toBe('number');
        expect(typeof dados.tempo_voo_ms).toBe('number');
        expect(typeof dados.velocidade_rato_px).toBe('number');
    });
});

describe('Regra de Ouro LGPD: bloqueio de keylogging e texto literal', () => {
    test.each([
        ['tecla', 'A'],
        ['key', 'Enter'],
        ['text', 'olá mundo'],
        ['texto', 'relatório confidencial'],
        ['conteudo', 'mensagem privada']
    ])('rejeita o campo proibido "%s"', (campo, valor) => {
        expect(validarTelemetria(pacoteBase({ [campo]: valor }))).toEqual({ sucesso: false, erro: 'Violação de LGPD' });
    });

    test.each(['TECLA', 'Key', 'TeXtO', 'Conteudo'])(
        'rejeita variações de maiúsculas/minúsculas ("%s")',
        (campo) => {
            expect(validarTelemetria(pacoteBase({ [campo]: 'x' })).erro).toBe('Violação de LGPD');
        }
    );

    test.each([
        ['keyCode', 65],
        ['keystrokes', 'senha123'],
        ['digitado', 'minha password'],
        ['password', 'segredo'],
        ['clipboard', 'texto copiado'],
        ['screenshot', 'data:image/png;base64,AAAA'],
        ['janelaAtiva', 'Outlook - Caixa de entrada'],
        ['url', 'https://exemplo.com']
    ])('rejeita campos não autorizados fora da lista branca ("%s")', (campo, valor) => {
        expect(validarTelemetria(pacoteBase({ [campo]: valor })).erro).toBe('Violação de LGPD');
    });

    test('rejeita texto escondido num objeto aninhado', () => {
        expect(validarTelemetria(pacoteBase({ meta: { buffer: 'texto digitado' } })).erro).toBe('Violação de LGPD');
    });

    test('rejeita texto literal injetado no userId', () => {
        expect(validarTelemetria(pacoteBase({ userId: 'joao.silva@empresa.com' })).erro).toBe('Violação de LGPD');
        expect(validarTelemetria(pacoteBase({ userId: 'a senha do joao é 1234' })).erro).toBe('Violação de LGPD');
    });

    test('rejeita texto literal no lugar de uma métrica numérica', () => {
        expect(validarTelemetria(pacoteBase({ dwellTime: 'olá' })).sucesso).toBe(false);
        expect(validarTelemetria(pacoteBase({ mouseSpeed: '350' })).sucesso).toBe(false);
    });

    test('tentativa de keylogging nunca devolve dados para a base de dados', () => {
        const resultado = validarTelemetria(pacoteBase({ tecla: 'A' }));

        expect(resultado).not.toHaveProperty('dados');
        expect(JSON.stringify(resultado)).not.toContain('"A"');
    });

    test('regista um alerta de segurança quando bloqueia keylogging', () => {
        validarTelemetria(pacoteBase({ tecla: 'A' }));

        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ALERTA DE SEGURANÇA'));
    });

    test('a lista branca contém apenas os 5 metadados matemáticos esperados', () => {
        expect(CAMPOS_PERMITIDOS).toEqual(['userId', 'timestamp', 'dwellTime', 'flightTime', 'mouseSpeed']);
    });
});

describe('Integridade estrutural', () => {
    test.each([null, undefined, 'texto', 42, [], [pacoteBase()]])('rejeita payload não-objeto (%p)', (payload) => {
        expect(validarTelemetria(payload)).toEqual({ sucesso: false, erro: 'Estrutura inválida' });
    });

    test.each(['userId', 'timestamp', 'dwellTime', 'flightTime', 'mouseSpeed'])(
        'rejeita pacote sem o campo obrigatório "%s"',
        (campo) => {
            const pacote = pacoteBase();
            delete pacote[campo];

            expect(validarTelemetria(pacote).sucesso).toBe(false);
        }
    );

    test.each([
        ['dwellTime', -1],
        ['flightTime', NaN],
        ['mouseSpeed', Infinity],
        ['timestamp', -5],
        ['timestamp', 1705432000000.5],
        ['timestamp', '2024-01-16']
    ])('rejeita valor numérico inválido em "%s" (%p)', (campo, valor) => {
        expect(validarTelemetria(pacoteBase({ [campo]: valor }))).toEqual({ sucesso: false, erro: 'Estrutura inválida' });
    });

    test('não lança exceção com timestamp ausente (antes causava RangeError)', () => {
        const pacote = pacoteBase();
        delete pacote.timestamp;

        expect(() => validarTelemetria(pacote)).not.toThrow();
    });
});
