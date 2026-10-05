## 1. Visão Geral da Arquitetura
Esta documentação detalha a primeira fase de implementação do módulo de Frontend do projeto **Ecos** (Avaliação A3 - Engenharia de Software). O objetivo deste módulo é fornecer uma interface segura, ética e anonimizada para a equipa de Saúde Ocupacional e Recursos Humanos, permitindo a visualização de métricas comportamentais sem acesso a dados pessoais ou conteúdo digitado (em estrita conformidade com a LGPD).

A arquitetura foi desenhada no modelo de **monorepo simplificado**, onde a pasta `frontend` convive lado a lado com a pasta `database` (responsabilidade da arquitetura de dados), permitindo integração contínua e rastreabilidade na gestão de configuração.

---

## 2. Stack Tecnológico: Escolhas e Justificações

### 2.1. React.js com TypeScript
*   **O que é:** Uma biblioteca JavaScript para construção de interfaces de utilizador baseada em componentes, tipada estaticamente com TypeScript.
*   **Onde foi aplicado:** Na raiz do projeto (`frontend/src`), formando a base de todos os ficheiros terminados em `.tsx` e `.ts`.
*   **Porquê (Justificação Técnica):** 
    *   O React permite a criação do paradigma *Feature-Sliced Design* (componentes isolados e reutilizáveis como botões, gráficos e painéis de alerta).
    *   O **TypeScript é um requisito crítico** neste projeto. Como lidamos com um motor analítico e métricas matemáticas exatas (ex: `dwell_time`, `flight_time`), o TypeScript garante que o frontend espelhe perfeitamente a estrutura da base de dados PostgreSQL, prevenindo erros de *runtime* caso a API devolva dados inesperados.

### 2.2. Vite (Build Tool)
*   **O que é:** Um *bundler* e servidor de desenvolvimento ultra-rápido.
*   **Onde foi aplicado:** Utilizado como motor de inicialização do projeto através do comando `npm create vite@latest`. A sua configuração reside no ficheiro `vite.config.ts`.
*   **Porquê (Justificação Técnica):** Substitui o antigo `Create React App` por ser substancialmente mais rápido (utiliza *Hot Module Replacement* instantâneo), melhorando a produtividade durante a Sprint e reduzindo o tempo de compilação das métricas.

### 2.3. Tailwind CSS (Versão 3)
*   **O que é:** Uma *framework* CSS utilitária para estilização rápida baseada em classes diretas no HTML/JSX.
*   **Onde foi aplicado:** Configurado nos ficheiros `tailwind.config.js` e globalmente injetado no `src/index.css` através das diretivas `@tailwind`.
*   **Porquê (Justificação Técnica):** O Ecos exige um *Design System* rígido voltado para a **Redução de Carga Cognitiva** do profissional de RH. O Tailwind permite codificar taxonomias visuais rapidamente (ex: `bg-red-100` para Alertas Críticos, `bg-green-100` para Normalidade) sem a necessidade de manter múltiplos e complexos ficheiros `.css` externos, garantindo consistência visual.

---

## 3. Metodologia de Implementação (Passo a Passo)

### Passo 1: Inicialização do Ambiente
O processo começou na raiz do projeto (`\Ecos`), assegurando que a infraestrutura ficasse paralela ao módulo de base de dados.
*   **Comando:** `npm create vite@latest frontend -- --template react-ts`
*   **Resultado:** Geração da *scaffold* (estrutura óssea) do React com as configurações de TypeScript (`tsconfig.json`) e *linting* (ESLint).

### Passo 2: Instalação de Dependências Críticas
Foram instaladas as bibliotecas que suportarão as regras de negócio nas próximas Sprints:
*   `axios`: Para requisições assíncronas à API (consumo de baselines e anomalias).
*   `react-router-dom`: Para gestão de rotas e proteção do ecrã de Dashboard (autenticação restrita ao RH).
*   `recharts`: Para plotagem dos gráficos de série temporal comparando a interação em tempo real com a *Baseline*.
*   `lucide-react`: Para iconografia vetorial limpa e leve.

### Passo 3: Configuração do Design System (Tailwind)
Ocorreu uma intervenção de versão durante a instalação do Tailwind. A versão mais recente (v4) apresentou incompatibilidades com o ambiente atual do NPM.
*   **Ação Corretiva:** Foi forçada a instalação da **versão 3** (`npm install -D tailwindcss@3`) por ser o padrão de mercado mais estável, acompanhado dos módulos *postcss* e *autoprefixer* para compatibilidade entre *browsers*.
*   **Configuração de Rotas de Estilo:** O ficheiro `tailwind.config.js` foi configurado para rastrear qualquer classe escrita em ficheiros `.tsx` dentro da pasta `src`.

### Passo 4: Limpeza e Criação do Ponto de Entrada (Entry Point)
O *template* padrão do Vite foi limpo (remoção do `App.css`) para evitar conflitos de estilo.
O ficheiro principal da aplicação (`src/App.tsx`) foi reescrito para testar a integração entre React e Tailwind, resultando na renderização de um *Card* corporativo de "Dashboard Inicializado" com *badges* de status.

### Passo 5: Gestão de Versão e Git
Todo o código gerado foi consolidado utilizando os princípios de gestão de configuração:
1.  Isolamento do código na ramificação designada (`git checkout -b andrade`).
2.  Empacotamento das alterações (`git commit -m "feat: setup inicial do frontend..."`).
3.  Sincronização com o repositório remoto no GitHub (`git push origin andrade`).

---

## 4. Alinhamento com os Requisitos do Sistema (A3)

Embora esta seja apenas a configuração inicial, as escolhas arquiteturais prepararam o terreno para o cumprimento direto dos requisitos delineados no escopo do projeto:

*   **Preparação para o RF02 e RNF02 (Anonimização):** A escolha do TypeScript permite a criação da interface `ColaboradorAnonimo` que exigirá, em tempo de compilação, que apenas identificadores como `codigo_anonimo` sejam processados, impedindo a injeção acidental de dados pessoais no Frontend.
*   **Preparação para o RNF03 (Segurança):** A instalação do `react-router-dom` será fundamental para criar *Private Routes* que bloqueiem o acesso à aplicação por qualquer pessoa que não possua um *Token* de RH válido.
*   **Preparação para o RNF07 (Apoio Preventivo):** A configuração bem-sucedida do Tailwind CSS permitirá estilizar as notificações da UI sem jargões médicos, utilizando apenas cores para guiar a atenção do utilizador.

---
*Fim do Relatório de Fase.*''')