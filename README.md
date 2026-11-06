# FK — Ficha Kamba

Plataforma web para organizar análises de futebol e construir boletins para Elephant Bet e BantuBet.

## Regras do produto
- Gerar entre 8 e 15 boletins por dia, apenas quando houver jogos e dados suficientes.
- Odd total mínima obrigatória: **10.00** por boletim.
- Misturar boletins de um único campeonato com combinados multicampeonato.
- Mostrar o ID/código de reserva abaixo do boletim quando for obtido por integração autorizada; nunca inventar códigos.
- Suportar Elephant Bet e BantuBet como casas-alvo.
- Usar componentes gratuitos/open-source e não depender de uma API de IA paga.

## Estado inicial
Este repositório começa com a base do frontend. A recolha de odds e a submissão de boletins dependem de feeds/API ou automação oficialmente permitidos pelas casas. Não guardar credenciais das casas no frontend nem contornar CAPTCHA, autenticação ou controlos de acesso. Até existir integração autorizada, os dados são inseridos/importados e os boletins ficam em modo de revisão.

## Desenvolvimento
```bash
npm install
npm run dev
```

## Próximas etapas
1. Backend e base de dados para jogos, odds, análises e histórico.
2. Fontes autorizadas de dados desportivos.
3. Motor estatístico local e integração opcional com modelo gratuito executado localmente (ex.: Ollama).
4. Adaptadores autorizados para Elephant Bet e BantuBet, incluindo leitura do ID de reserva quando disponibilizado.
5. Agendamento diário, auditoria e painel de resultados.

> As odds e probabilidades não garantem ganhos. O sistema deve apresentar incerteza e manter aprovação humana antes de qualquer aposta.
