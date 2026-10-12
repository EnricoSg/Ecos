const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Compara dois segredos em tempo constante. O hash iguala os tamanhos, exigência do timingSafeEqual,
// e evita que o tempo de resposta revele quantos caracteres coincidem.
function segredosIguais(recebido, esperado) {
    if (typeof recebido !== 'string' || !esperado) {
        return false;
    }

    const a = crypto.createHash('sha256').update(recebido).digest();
    const b = crypto.createHash('sha256').update(esperado).digest();

    return crypto.timingSafeEqual(a, b);
}

// Protege a entrada de telemetria: só o coletor oficial conhece a chave.
// Sem API_KEY configurada a rota fica fechada (falha segura), nunca aberta.
function exigirChaveApi(config) {
    return (req, res, next) => {
        if (!config.apiKey) {
            return res.status(503).json({ erro: 'Chave de API não configurada no servidor' });
        }

        if (!segredosIguais(req.get('X-API-Key'), config.apiKey)) {
            return res.status(401).json({ erro: 'Chave de API inválida ou ausente' });
        }

        next();
    };
}

// Protege as rotas do Dashboard: exige um token JWT emitido pelo POST /api/login
function exigirJwt(config) {
    return (req, res, next) => {
        if (!config.jwtSegredo) {
            return res.status(503).json({ erro: 'Autenticação não configurada no servidor' });
        }

        const [esquema, token] = (req.get('Authorization') || '').split(' ');

        if (esquema !== 'Bearer' || !token) {
            res.set('WWW-Authenticate', 'Bearer');
            return res.status(401).json({ erro: 'Token ausente' });
        }

        try {
            // O algoritmo é fixado para impedir tokens forjados com "alg: none" ou outro algoritmo
            req.usuario = jwt.verify(token, config.jwtSegredo, { algorithms: ['HS256'] });
            next();
        } catch (erro) {
            res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
            const mensagem = erro.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido';
            return res.status(401).json({ erro: mensagem });
        }
    };
}

function emitirToken(config, usuario) {
    const token = jwt.sign({ papel: 'RH' }, config.jwtSegredo, {
        algorithm: 'HS256',
        subject: usuario,
        expiresIn: config.jwtExpiraEm
    });
    const { exp } = jwt.decode(token);

    return { token, expiraEm: new Date(exp * 1000).toISOString() };
}

module.exports = { segredosIguais, exigirChaveApi, exigirJwt, emitirToken };
