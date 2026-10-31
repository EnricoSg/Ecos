// Auxiliares para validar query params das rotas de leitura.
// Cada função devolve { valor } ou { erro } para a rota responder 400 com uma mensagem clara.

const DIA_MS = 24 * 60 * 60 * 1000;
const PERIODO_PADRAO_DIAS = 30;
const PERIODO_MAXIMO_DIAS = 366;

// Nomes em português na API, traduzidos para as unidades do date_trunc do PostgreSQL
const AGRUPAMENTOS = { hora: 'hour', dia: 'day', semana: 'week' };

// AAAA-MM-DD, opcionalmente com hora (e fuso Z ou ±hh:mm). O `new Date()` sozinho aceita lixo
// como "1" (vira 2001-01-01) e "2026-02-30" (vira 2 de março), por isso o formato é conferido antes.
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function lerInteiroPositivo(valor, { padrao, maximo, nome }) {
    if (valor === undefined) {
        return { valor: padrao };
    }

    // Só dígitos: rejeita "1e3", "0x10", " 5", "1.0" e query params repetidos (?limite=1&limite=2)
    let numero = NaN;
    if (typeof valor === 'number') {
        numero = valor;
    } else if (typeof valor === 'string' && /^\d{1,10}$/.test(valor)) {
        numero = Number(valor);
    }

    if (!Number.isInteger(numero) || numero < 1 || (maximo && numero > maximo)) {
        const faixa = maximo ? ` entre 1 e ${maximo}` : ' positivo';
        return { erro: `O parâmetro "${nome}" deve ser um número inteiro${faixa}.` };
    }

    return { valor: numero };
}

function diaExiste(ano, mes, dia) {
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

function lerData(valor, nome) {
    if (valor === undefined) {
        return { valor: undefined };
    }

    const partes = typeof valor === 'string' ? DATA_ISO.exec(valor) : null;
    const data = partes && diaExiste(Number(partes[1]), Number(partes[2]), Number(partes[3])) ? new Date(valor) : null;

    if (!data || Number.isNaN(data.getTime())) {
        return { erro: `O parâmetro "${nome}" deve ser uma data ISO 8601 (ex.: 2026-10-01 ou 2026-10-01T00:00:00-03:00).` };
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
