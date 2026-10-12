const { lerConfig } = require('../config');

const USER_ID = 'a2a0159acf6ac55f05c0c4d4bdc54004';
const API_KEY = 'chave-de-teste-do-coletor';
const JWT_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

function pacoteBase(extra = {}) {
    return {
        userId: USER_ID,
        timestamp: 1790723199823,
        dwellTime: 103,
        flightTime: 68,
        mouseSpeed: 476,
        ...extra
    };
}

// Configuração completa de teste; cada teste pode sobrescrever o que precisar
function configTeste(extra = {}) {
    return {
        ...lerConfig({}),
        apiKey: API_KEY,
        rhUsuario: 'rh',
        rhSenha: 'senha-do-rh',
        jwtSegredo: JWT_SECRET,
        ...extra
    };
}

function configComLimites(limites) {
    const config = configTeste();
    return { ...config, limites: { ...config.limites, ...limites } };
}

// Banco simulado: cada chamada a query devolve o próximo resultado da lista (o último se repete)
function criarBancoFalso(...resultados) {
    const lista = resultados.length > 0 ? resultados : [{ rows: [] }];
    const query = jest.fn();

    lista.forEach((resultado) => query.mockResolvedValueOnce(resultado));
    query.mockResolvedValue(lista[lista.length - 1]);

    return { query };
}

function silenciarConsole() {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
}

module.exports = {
    USER_ID,
    API_KEY,
    JWT_SECRET,
    pacoteBase,
    configTeste,
    configComLimites,
    criarBancoFalso,
    silenciarConsole
};
