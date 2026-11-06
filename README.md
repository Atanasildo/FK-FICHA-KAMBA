# FK — Ficha Kamba

Aplicação web responsiva, em português (Angola), para registar jogos e mercados, construir boletins, acompanhar selecções e consultar o histórico.

## Funcionalidades já implementadas

- Painel com contagem de boletins, jogos e metas.
- Registo manual de jogos, campeonatos, mercados, selecções e odds.
- Construtor de boletins com multiplicação automática das odds.
- Validação de odd mínima **1.40 por selecção** e odd total mínima **10.00**.
- Identificação automática de boletins com odd total **>= 100.00**.
- Escolha entre BantuBet Angola e Elephant Bet Angola.
- Campo para guardar um ID de reserva verdadeiro, quando o utilizador o obtiver.
- Acompanhamento manual do resultado de cada selecção.
- Histórico, pesquisa, filtros e análise dos boletins guardados.
- Exportação de cópia de segurança em JSON.
- Armazenamento local no navegador e interface adaptada a telemóveis.
- Manifesto PWA e ícone da aplicação.

## Regras do produto

- Objectivo de **8 a 15 boletins por dia**, dependendo da disponibilidade e qualidade dos jogos.
- Procurar incluir **3 boletins com odd total >= 100.00**, apenas quando existirem dados suficientes.
- Cada selecção deve ter odd **>= 1.40**.
- Cada boletim normal deve ter odd total **>= 10.00**.
- Misturar boletins de uma liga e de várias ligas, conforme as oportunidades.
- Não inventar jogos, odds, estatísticas, resultados ou IDs de reserva.
- O FK não coloca apostas, não recebe dinheiro e não gere depósitos ou levantamentos.
- IA gratuita/open-source, sem APIs pagas de IA. Os cálculos de odds são determinísticos.

## Limitações que continuam pendentes

Esta versão é um **MVP funcional local**, não é ainda uma plataforma de dados desportivos em directo.

- Jogos e odds são inseridos manualmente; ainda não há fornecedor de dados ligado.
- O acompanhamento actualiza-se manualmente; não recebe placares, minutos ou eventos automaticamente.
- As casas BantuBet Angola e Elephant Bet Angola ainda não têm adaptadores autorizados ligados. O ID de reserva é manual.
- O serviço de IA local (por exemplo, Ollama com modelo open-weight compatível) ainda precisa de instalação e configuração num servidor/PC.
- Os registos são guardados no \`localStorage\` do navegador. Não sincronizam entre dispositivos nem constituem uma base de dados central.
- As metas diárias não geram palpites por si mesmas. Não são criados boletins sem jogos, odds e dados confirmados.

Não contornar CAPTCHA, autenticação, controlos anti-bot ou restrições das casas. Qualquer integração deve respeitar os termos e permissões do fornecedor.

## Executar no computador

Requer Node.js 20 ou superior.

\`\`\`bash
npm install
npm run dev
\`\`\`

Abre o endereço local indicado pelo Vite (normalmente \`http://localhost:5173\`). **Não abras index.html directamente com duplo clique**: o projecto usa Vite/React e precisa do servidor de desenvolvimento.

Para testar a versão de produção:

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Publicar na Vercel

Importa \`Atanasildo/FK-FICHA-KAMBA\` na Vercel. O projecto usa Vite:

- Framework Preset: Vite
- Install Command: \`npm install\`
- Build Command: \`npm run build\`
- Output Directory: \`dist\`
- Root Directory: \`./\`

Não são necessárias variáveis de ambiente para o MVP actual.

## Próximas fases técnicas

1. Backend e base de dados central (contas, permissões, jogos, boletins e histórico).
2. Fornecedor autorizado de jogos, odds e eventos em directo, com limites e proveniência visíveis.
3. Motor estatístico auditável para forma, casa/fora, confrontos e mercados.
4. Adaptadores permitidos para as casas e processo de reserva sem contornar mecanismos de segurança.
5. Serviço local de IA open-source, com modelo e licença verificados.
6. Alertas em tempo real, notificações e relatórios diários.

A aplicação deve apresentar claramente a origem e a hora de actualização de todos os dados externos quando essas integrações forem adicionadas.
