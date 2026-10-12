// Auxiliares para validar query params das rotas de leitura.
// Cada função devolve { valor } ou { erro } para a rota responder 400 com uma mensagem clara.

const DIA_MS = 24 * 60 * 60 * 1000;
const PERIODO_PADRAO_DIAS = 30;
const PERIODO_MAXIMO_DIAS = 366;

// Nomes em português na API, traduzidos para as unidades do date_trunc do PostgreSQL
const AGRUPAMENTOS = { hora: 'hour', dia: 'day', semana: 'week' };

function lerInteiroPositivo(valor, { padrao, maximo, nome }) {
    if (valor === undefined) {
        return { valor: padrao };
    }

    const numero = Number(valor);

    if (!Number.isInteger(numero) || numero < 1 || (maximo && numero > maximo)) {
        const faixa = maximo ? ` entre 1 e ${maximo}` : ' positivo';
        return { erro: `O parâmetro "${nome}" deve ser um número inteiro${faixa}.` };
    }

    return { valor: numero };
}

function lerData(valor, nome) {
    if (valor === undefined) {
        return { valor: undefined };
    }

    const data = new Date(valor);

    if (typeof valor !== 'string' || Number.isNaN(data.getTime())) {
        return { erro: `O parâmetro "${nome}" deve ser uma data ISO 8601 (ex.: 2026-10-01).` };
    }

    return { valor: data };
}

// Lê inicio, fim e agrupamento. Sem datas, devolve os últimos 30 dias.
function lerPeriodo(query) {
    const inicio = lerData(query.inicio, 'inicio');
    if (inicio.erro) return inicio;

    const fim = lerData(query.fim, 'fim');
    if (fim.erro) return fim;

    const dataFim = fim.valor || new Date();
    const dataInicio = inicio.valor || new Date(dataFim.getTime() - PERIODO_PADRAO_DIAS * DIA_MS);

    if (dataInicio >= dataFim) {
        return { erro: 'O parâmetro "inicio" deve ser anterior a "fim".' };
    }

    if (dataFim - dataInicio > PERIODO_MAXIMO_DIAS * DIA_MS) {
        return { erro: `O período consultado não pode passar de ${PERIODO_MAXIMO_DIAS} dias.` };
    }

    const agrupamento = query.agrupamento || 'dia';

    if (!Object.hasOwn(AGRUPAMENTOS, agrupamento)) {
        return { erro: `O parâmetro "agrupamento" deve ser um destes: ${Object.keys(AGRUPAMENTOS).join(', ')}.` };
    }

    return {
        valor: {
            inicio: dataInicio.toISOString(),
            fim: dataFim.toISOString(),
            agrupamento,
            unidadeSql: AGRUPAMENTOS[agrupamento]
        }
    };
}

// Query params repetidos (?status=a&status=b) chegam como array; aqui só aceitamos um valor
function lerTextoOpcional(valor, nome) {
    if (valor === undefined || valor === '') {
        return { valor: null };
    }

    if (typeof valor !== 'string' || valor.length > 100) {
        return { erro: `O parâmetro "${nome}" deve ser um texto único de até 100 caracteres.` };
    }

    return { valor };
}

module.exports = { lerInteiroPositivo, lerPeriodo, lerTextoOpcional, AGRUPAMENTOS };
