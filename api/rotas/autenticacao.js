const express = require('express');
const { segredosIguais, emitirToken } = require('../middlewares/autenticacao');

function criarRotasAutenticacao({ config, limites }) {
    const rotas = express.Router();

    /**
     * @openapi
     * /api/login:
     *   post:
     *     summary: Autentica o RH e devolve um token JWT
     *     description: |
     *       Provisório: as credenciais vêm de `RH_USUARIO` e `RH_SENHA` no `.env`, até existir uma tabela de usuários do RH.
     *       Copie o `token` da resposta e cole no botão **Authorize** (bearerAuth) para testar as rotas do Dashboard.
     *       Após 10 tentativas falhas em 15 minutos, o IP recebe 429.
     *     tags: [Autenticação]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [usuario, senha]
     *             properties:
     *               usuario: { type: string, example: rh }
     *               senha: { type: string, format: password, example: troque-esta-senha }
     *     responses:
     *       200:
     *         description: Credenciais válidas
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 token: { type: string, example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... }
     *                 tipo: { type: string, example: Bearer }
     *                 expira_em: { type: string, format: date-time, example: '2026-10-12T23:00:00.000Z' }
     *       400:
     *         description: Corpo sem usuario ou senha
     *         content:
     *           application/json:
     *             example: { erro: Informe usuario e senha }
     *       401:
     *         description: Usuário ou senha incorretos
     *         content:
     *           application/json:
     *             example: { erro: Credenciais inválidas }
     *       429:
     *         $ref: '#/components/responses/MuitasRequisicoes'
     *       503:
     *         description: RH_USUARIO, RH_SENHA ou JWT_SECRET não configurados
     *         content:
     *           application/json:
     *             example: { erro: Login não configurado no servidor }
     */
    rotas.post('/api/login', limites.login, (req, res) => {
        if (!config.rhUsuario || !config.rhSenha || !config.jwtSegredo) {
            return res.status(503).json({ erro: 'Login não configurado no servidor' });
        }

        const { usuario, senha } = req.body || {};

        if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario || !senha) {
            return res.status(400).json({ erro: 'Informe usuario e senha' });
        }

        // As duas comparações rodam sempre, para não revelar pelo tempo qual dos campos errou
        const usuarioConfere = segredosIguais(usuario, config.rhUsuario);
        const senhaConfere = segredosIguais(senha, config.rhSenha);

        if (!usuarioConfere || !senhaConfere) {
            return res.status(401).json({ erro: 'Credenciais inválidas' });
        }

        const { token, expiraEm } = emitirToken(config, usuario);
        res.json({ token, tipo: 'Bearer', expira_em: expiraEm });
    });

    return rotas;
}

module.exports = { criarRotasAutenticacao };
