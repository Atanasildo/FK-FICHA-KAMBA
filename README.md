# FK — Ficha Kamba

Plataforma web responsiva para organizar análises de futebol, construir boletins e acompanhar os seus jogos.

## Regras do produto

- Gerar entre **8 e 15 boletins por dia**, conforme a disponibilidade e qualidade dos jogos.
- Procurar incluir **3 boletins com odd total >= 100.00**, apenas quando existirem dados suficientes para sustentar as selecções.
- Cada selecção deve ter odd **>= 1.40**; cada boletim normal deve ter odd total **>= 10.00**.
- Combinar boletins de um só campeonato com boletins de vários campeonatos.
- Casas previstas: **BantuBet Angola** e **Elephant Bet Angola**.
- Nunca inventar jogos, odds, estatísticas, resultados ou IDs de reserva.
- Sem apostas com dinheiro, depósitos ou levantamentos.
- IA gratuita/open-source, executada localmente (por exemplo, Ollama). Os cálculos e validações de odds devem ser determinísticos.

## Estado actual

O repositório contém o primeiro MVP da interface. Os cartões com jogos e odds estão assinalados como **DEMO** e usam dados fictícios de apresentação. Não são jogos actuais, prognósticos reais nem odds verificadas. O acompanhamento em directo e as integrações das casas ainda não estão ligados.

A obtenção de um ID de reserva depende de uma integração oficialmente permitida. Até existir essa integração, o código real terá de ser introduzido manualmente. Não contornar CAPTCHA, autenticação ou controlos de acesso.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

## Próximas etapas

1. Backend e base de dados para persistência.
2. Fontes autorizadas de jogos, odds e eventos em directo.
3. Motor estatístico auditável e validação automática das regras.
4. Adaptadores autorizados para BantuBet e Elephant Bet.
5. Serviço local de IA open-source opcional.

A interface não deve ser interpretada como fonte de dados desportivos em tempo real até essas integrações estarem concluídas.
