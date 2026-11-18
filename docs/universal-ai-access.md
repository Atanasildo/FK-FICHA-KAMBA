# Acesso universal de IAs — Ficha Kamba

## Estado
Esta integração está em desenvolvimento na branch `feat/universal-ai-analysis-access`. A API não está activa em produção e a migration ainda não foi aplicada ao Supabase.

## Princípio
Qualquer plataforma de IA pode usar a mesma API REST depois de receber uma chave individual. Não existe IA principal. Cada chave tem os mesmos escopos: leitura de jogos, gravação de análises e publicação de boletins. O nome/modelo declarado pela plataforma fica associado à análise e ao registo de auditoria.

A API não entrega a chave service-role nem `CRON_SECRET` às IAs. A chave individual é validada no servidor por hash SHA-256 e pode ser revogada. A chave administrativa `FK_AI_KEY_ADMIN_SECRET` serve apenas para emitir/revogar chaves e nunca deve ser entregue a uma IA.

## Endpoints planeados

Base: `https://<dominio-publico>/api/ai-access`

### 1. Consultar jogos
`GET /api/ai-access?op=fixtures&limit=25&offset=0`

Header: `Authorization: Bearer fkai_...`

Devolve jogos Swarm ainda por iniciar no dia de Luanda, a comparação mais recente de odds, estatísticas recolhidas e análises anteriores.

### 2. Guardar análise
`POST /api/ai-access`

Headers: `Authorization: Bearer fkai_...`, `Content-Type: application/json`

Body:
```json
{
  "action": "submit-analysis",
  "model": "nome-do-modelo",
  "matchId": "UUID-da-tabela-matches",
  "analysis": {
    "fixture": { "home": "Equipa da casa", "away": "Equipa visitante" },
    "verdict": "Conclusão fundamentada",
    "sources": [],
    "selections": []
  }
}
```

A análise é gravada em `match_analyses`, com `provider` igual ao nome da IA autenticada. A API confirma que o jogo pertence à recolha Swarm, ainda não começou e que as equipas coincidem.

A IA também pode enviar o campo opcional `research` para guardar pesquisa externa em `match_statistics`. Quando enviado, exige pelo menos três factos e duas fontes HTTP/HTTPS distintas, com pelo menos dois factos ligados a URLs declarados:

```json
{
  "research": {
    "status": "complete",
    "checkedAt": "2026-11-18T15:00:00Z",
    "facts": [
      { "topic": "recent_form", "claim": "Facto confirmado e datado.", "sourceUrl": "https://fonte-a.example", "observedAt": "2026-11-18T14:00:00Z" },
      { "topic": "standings", "claim": "Classificação confirmada.", "sourceUrl": "https://fonte-b.example", "observedAt": "2026-11-18T14:00:00Z" },
      { "topic": "availability", "claim": "Disponibilidade consultada; sem confirmação de ausências.", "sourceUrl": "https://fonte-a.example", "observedAt": "2026-11-18T14:00:00Z" }
    ],
    "sources": [
      { "name": "Fonte A", "url": "https://fonte-a.example", "checkedAt": "2026-11-18T14:00:00Z", "usedFor": "Forma recente" },
      { "name": "Fonte B", "url": "https://fonte-b.example", "checkedAt": "2026-11-18T14:00:00Z", "usedFor": "Classificação" }
    ],
    "limitations": ["Escalações ainda não confirmadas."]
  }
}
```

Na gravação de uma análise com selecções, a API não confia nas odds enviadas pela IA: compara mercado, selecção e linha com a última comparação guardada e substitui as cotações pelas odds efectivamente recolhidas nas duas casas. A comparação tem de ter menos de uma hora e cada casa deve apresentar odd igual ou superior a 1,40.

### 3. Publicar boletins
`POST /api/ai-access`

Headers: `Authorization: Bearer fkai_...`, `Content-Type: application/json`, `Idempotency-Key: identificador-unico-com-pelo-menos-8-caracteres`

Body:
```json
{
  "action": "publish",
  "pool": [
    {
      "fixtureId": "ID externo do jogo",
      "home": "Equipa da casa",
      "away": "Equipa visitante",
      "competition": "Competição",
      "kickoff": "2026-11-18T20:00:00Z",
      "market": "Mercado",
      "selection": "Selecção",
      "fairProbability": 0.65,
      "rationale": "Fundamentação da selecção com pelo menos 12 caracteres",
      "quotes": [
        { "bookmaker": "BantuBet", "odds": 1.8, "collectedAt": "2026-11-18T15:00:00Z" },
        { "bookmaker": "ElephantBet", "odds": 1.75, "collectedAt": "2026-11-18T15:00:00Z" }
      ]
    }
  ]
}
```

O formato do pool deve respeitar também todos os requisitos do construtor existente em `lib/tickets/builder.js`. A API reutiliza o publicador existente, não duplica a lógica de boletins. Esse fluxo cria referências de partilha/reserva nas casas e publica os pares confirmados no site. Não coloca apostas nem movimenta dinheiro. Se a casa não confirmar as referências necessárias, o par não é publicado.

Uma chave de idempotência só pode ser usada uma vez por IA. Se houver timeout ou resposta incerta, consultar o estado antes de tentar novamente.

### 4. Consultar publicação
`POST /api/ai-access`

Body: `{"action":"status","publicationId":"UUID-de-publicacao"}`

A IA só pode consultar publicações criadas com a sua própria chave.

## Emissão e revogação de chaves
Apenas o operador do projecto pode chamar:
- `POST /api/ai-access?action=issue-key` com `x-fk-ai-admin-secret` e body `{"action":"issue-key","name":"Claude"}`.
- `POST /api/ai-access?action=revoke-key` com `x-fk-ai-admin-secret` e body `{"action":"revoke-key","keyId":"UUID"}`.

O token é mostrado uma única vez. Guardar num gestor de segredos e configurar a integração da plataforma. Nunca o colocar no Manual Mestre, no repositório, em prompts públicos ou em conversas.

## Segurança e limitações de deployment
- A migration cria tabelas sem políticas RLS para anon/authenticated; só o servidor com service-role pode aceder.
- Cada IA tem permissões equivalentes e independentes.
- Não há acesso a utilizadores, pagamentos, depósitos, levantamentos, odds brutas ou credenciais internas.
- O endpoint não deve ficar exposto enquanto o deployment Preview estiver protegido por SSO. Não partilhar bypass token nem desligar a protecção SSO global.
- A disponibilização externa exige domínio/rota pública aprovada, variáveis `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` e `FK_AI_KEY_ADMIN_SECRET` configuradas no servidor.
- A migration deste branch deve ser revista e aprovada antes de qualquer aplicação no Supabase de produção.

## Manual Mestre
O Manual Mestre define como analisar; esta API define como consultar, guardar e publicar. São componentes separados. O manual deve ser fornecido à IA juntamente com a documentação OpenAPI e a chave individual, configurada fora da conversa.
