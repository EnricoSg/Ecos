// Roda um script Python com o Python do .venv do projeto (ou o do sistema), repassando os argumentos.
// Assim os comandos do npm funcionam igual no Windows, Linux e macOS.
// Ex.: node scripts/python.js ai/gerar_demo.py --confirmar

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { caminhoPython } = require('./iniciar');

const RAIZ = path.resolve(__dirname, '..');
const python = caminhoPython();

const resultado = spawnSync(python, process.argv.slice(2), {
    cwd: RAIZ,
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
});

if (resultado.error) {
    console.error(`🔴 Não foi possível rodar o Python (${python}): ${resultado.error.message}. Crie o .venv (veja o README).`);
    process.exit(1);
}

process.exit(resultado.status ?? 1);
