const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

function respostaErro(descricao, exemplo) {
    return {
        description: descricao,
        content: {
            'application/json': {
                schema: { $ref: '#/components/schemas/Erro' },
                example: exemplo
            }
        }
    };
}

// Especificação OpenAPI gerada a partir dos comentários @openapi em app.js e rotas/
const especificacao = swaggerJsdoc({
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'API Ecos',
            version: '2.0.0',
            description: [
                'Recebe telemetria do coletor, aplica o validador LGPD, grava no PostgreSQL e serve os dados do Dashboard do RH.',
                '',
                '**Como autorizar no Swagger:**',
                '- **Coletor** (`POST /api/telemetria`): clique em **Authorize** e preencha `chaveApi` com o valor de `API_KEY` do `.env`.',
                '- **RH** (rotas do Dashboard): faça `POST /api/login`, copie o `token` e cole em `bearerAuth` no **Authorize**.'
            ].join('\n')
        },
        servers: [{ url: '/', description: 'Servidor atual' }],
        tags: [
            { name: 'Telemetria', description: 'Entrada de dados do coletor' },
            { name: 'Autenticação', description: 'Login do RH' },
            { name: 'Alertas', description: 'Alertas gerados pela IA' },
            { name: 'Análises', description: 'Dados agregados para os gráficos do Dashboard' },
            { name: 'Saúde', description: 'Monitoramento' }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Token devolvido pelo POST /api/login (cole apenas o token, sem a palavra Bearer).'
                },
                chaveApi: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-API-Key',
                    description: 'Chave do coletor oficial (variável API_KEY do .env).'
                }
            },
            parameters: {
                Inicio: {
                    in: 'query',
                    name: 'inicio',
                    description: 'Início do período (ISO 8601). Padrão: 30 dias antes de `fim`.',
                    schema: { type: 'string', format: 'date-time' },
                    example: '2026-09-12T00:00:00Z'
                },
                Fim: {
                    in: 'query',
                    name: 'fim',
                    description: 'Fim do período, exclusivo (ISO 8601). Padrão: agora. Máximo de 366 dias de intervalo.',
                    schema: { type: 'string', format: 'date-time' }
                },
                Agrupamento: {
                    in: 'query',
                    name: 'agrupamento',
                    description: 'Granularidade da série temporal.',
                    schema: { type: 'string', enum: ['hora', 'dia', 'semana'], default: 'dia' }
                }
            },
            schemas: {
                Telemetria: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['userId', 'timestamp', 'dwellTime', 'flightTime', 'mouseSpeed'],
                    properties: {
                        userId: {
                            type: 'string',
                            description: 'Hash anônimo do colaborador em hexadecimal (nunca e-mail ou nome).',
                            example: 'a2a0159acf6ac55f05c0c4d4bdc54004'
                        },
                        timestamp: {
                            type: 'integer',
                            format: 'int64',
                            description: 'Momento da coleta em milissegundos desde a época Unix.',
                            example: 1790723199823
                        },
                        dwellTime: { type: 'integer', minimum: 0, description: 'Tempo de pressão da tecla, em ms.', example: 103 },
                        flightTime: { type: 'integer', minimum: 0, description: 'Tempo entre teclas, em ms.', example: 68 },
                        mouseSpeed: { type: 'integer', minimum: 0, description: 'Velocidade do mouse, em px.', example: 476 }
                    }
                },
                TelemetriaCriada: {
                    type: 'object',
                    description: 'Resposta para um objeto único',
                    properties: {
                        mensagem: { type: 'string', example: 'Telemetria registrada com sucesso' },
                        id: { type: 'integer', example: 42 },
                        data_coleta: { type: 'string', format: 'date-time', example: '2026-09-29T23:06:39.823Z' }
                    }
                },
                LoteCriado: {
                    type: 'object',
                    description: 'Resposta para um lote (array)',
                    properties: {
                        mensagem: { type: 'string', example: 'Lote de telemetria registrado com sucesso' },
                        quantidade: { type: 'integer', example: 2 },
                        ids: { type: 'array', items: { type: 'integer' }, example: [42, 43] }
                    }
                },
                Alerta: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer', example: 7 },
                        status: { type: 'string', enum: ['PENDENTE', 'RESOLVIDO'] },
                        mensagem: { type: 'string', example: 'Desvio comportamental de nível alto detectado. Recomenda-se acompanhamento.' },
                        data_criacao: { type: 'string', format: 'date-time' },
                        data_resolucao: { type: 'string', format: 'date-time', nullable: true },
                        anomalia: {
                            type: 'object',
                            properties: {
                                id: { type: 'integer', example: 15 },
                                nivel: { type: 'string', enum: ['BAIXO', 'MEDIO', 'ALTO'] },
                                pontuacao_desvio: { type: 'number', example: 0.231456 },
                                data_deteccao: { type: 'string', format: 'date-time' }
                            }
                        },
                        colaborador: {
                            type: 'object',
                            properties: {
                                codigo_anonimo: { type: 'string', example: 'a2a0159acf6ac55f05c0c4d4bdc54004' },
                                setor: { type: 'string', example: 'TI' }
                            }
                        }
                    }
                },
                Erro: {
                    type: 'object',
                    required: ['erro'],
                    properties: {
                        erro: { type: 'string' },
                        detalhe: { type: 'string' },
                        indice: { type: 'integer', description: 'Posição (a partir de 0) do pacote rejeitado em um lote' }
                    }
                }
            },
            responses: {
                ParametroInvalido: respostaErro('Query param inválido', {
                    erro: 'Parâmetro inválido',
                    detalhe: 'O parâmetro "agrupamento" deve ser um destes: hora, dia, semana.'
                }),
                NaoAutenticado: respostaErro('Token JWT ausente, inválido ou expirado', { erro: 'Token ausente' }),
                ChaveApiInvalida: respostaErro('Cabeçalho X-API-Key ausente ou incorreto', { erro: 'Chave de API inválida ou ausente' }),
                MuitasRequisicoes: respostaErro('Limite de requisições atingido', { erro: 'Muitas requisições. Tente novamente mais tarde.' }),
                ErroInterno: respostaErro('Erro interno (detalhes nunca são expostos)', { erro: 'Erro interno do servidor' })
            }
        }
    },
    // O glob do swagger-jsdoc só entende "/", por isso as barras do Windows são convertidas
    apis: [path.join(__dirname, 'app.js'), path.join(__dirname, 'rotas', '*.js')].map((caminho) => caminho.replace(/\\/g, '/'))
});

module.exports = { especificacao };
