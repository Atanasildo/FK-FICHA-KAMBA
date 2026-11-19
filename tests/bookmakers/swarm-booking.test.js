import test from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import {
  buildBetBook,
  parseBetBookResponse,
  createBetBook,
  resolveSelectionIds
} from "../../lib/bookmakers/swarm.js";

test("buildBetBook gera o mesmo corpo que o site (múltipla, Amount 0)", () => {
  assert.deepEqual(buildBetBook([{ id: "7433027412", price: 5.1 }, { id: 7433027429, price: "3.85" }]), {
    bets: [{
      BetType: 2,
      Selections: [{ SelectionId: 7433027412, Price: 5.1 }, { SelectionId: 7433027429, Price: 3.85 }],
      Amount: 0
    }]
  });
});

test("buildBetBook usa BetType 1 para uma só selecção", () => {
  assert.equal(buildBetBook([{ id: 1, price: 1.5 }]).bets[0].BetType, 1);
});

test("buildBetBook recusa dados inválidos", () => {
  assert.throws(() => buildBetBook([]), /pelo menos uma/);
  assert.throws(() => buildBetBook([{ id: "abc", price: 2 }]), /SelectionId/);
  assert.throws(() => buildBetBook([{ id: 5, price: 1 }]), /Preço inválido/);
  assert.throws(() => buildBetBook([{ id: 5, price: 2 }, { id: 5, price: 2 }]), /repetida/);
});

test("parseBetBookResponse devolve o código real da casa", () => {
  const reply = {
    code: 0, rid: "x",
    data: { result: 0, result_text: null, details: { Id: 979460, PartnerId: 18756188 } }
  };
  assert.deepEqual(parseBetBookResponse(reply), { bookingId: "979460", partnerId: 18756188 });
});

test("parseBetBookResponse recusa respostas sem código válido", () => {
  assert.throws(() => parseBetBookResponse({ code: 1 }), /código 1/);
  assert.throws(() => parseBetBookResponse({ code: 0, data: { result: 5, result_text: "odd mudou" } }), /odd mudou/);
  assert.throws(() => parseBetBookResponse({ code: 0, data: { result: 0, details: {} } }), /código de reserva válido/);
});

function startFakeSwarm(handler) {
  return new Promise(resolve => {
    const server = new WebSocketServer({ port: 0 });
    const received = [];
    server.on("connection", ws => {
      ws.on("message", raw => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        handler(ws, msg);
      });
    });
    server.on("listening", () => resolve({
      server, received, url: "ws://127.0.0.1:" + server.address().port + "/"
    }));
  });
}

test("createBetBook abre sessão, envia create_bet_book_v2 e devolve o código", async () => {
  const fake = await startFakeSwarm((ws, msg) => {
    if (msg.command === "request_session") ws.send(JSON.stringify({ code: 0, rid: msg.rid, data: {} }));
    if (msg.command === "create_bet_book_v2") {
      ws.send(JSON.stringify({ code: 0, rid: msg.rid, data: { result: 0, result_text: null, details: { Id: 979460, PartnerId: 18756188 } } }));
    }
  });
  try {
    const result = await createBetBook({
      siteId: 18756188, wsUrl: fake.url, timeoutMs: 3000,
      selections: [{ id: 7433027412, price: 5.1 }, { id: 7433027429, price: 3.85 }]
    });
    assert.equal(result.bookingId, "979460");
    const sent = fake.received.find(m => m.command === "create_bet_book_v2");
    assert.equal(sent.params.bets[0].Amount, 0);
    assert.equal(sent.params.bets[0].BetType, 2);
  } finally { fake.server.close(); }
});

test("createBetBook não repete o pedido quando a casa não responde", async () => {
  const fake = await startFakeSwarm((ws, msg) => {
    if (msg.command === "request_session") ws.send(JSON.stringify({ code: 0, rid: msg.rid, data: {} }));
    // create_bet_book_v2 fica sem resposta
  });
  try {
    await assert.rejects(
      createBetBook({ siteId: 1, wsUrl: fake.url, timeoutMs: 600, selections: [{ id: 9, price: 2 }] }),
      /Tempo limite/
    );
    assert.equal(fake.received.filter(m => m.command === "create_bet_book_v2").length, 1);
  } finally { fake.server.close(); }
});

test("createBetBook propaga a recusa da casa", async () => {
  const fake = await startFakeSwarm((ws, msg) => {
    if (msg.command === "request_session") ws.send(JSON.stringify({ code: 0, rid: msg.rid, data: {} }));
    if (msg.command === "create_bet_book_v2") {
      ws.send(JSON.stringify({ code: 0, rid: msg.rid, data: { result: 2007, result_text: "Evento indisponível" } }));
    }
  });
  try {
    await assert.rejects(
      createBetBook({ siteId: 1, wsUrl: fake.url, timeoutMs: 3000, selections: [{ id: 9, price: 2 }] }),
      /Evento indisponível/
    );
  } finally { fake.server.close(); }
});

const game = {
  markets: [
    { name: "Resultado do Jogo", base: null, selections: [
      { id: "11", name: "W1", odd: 2.1, base: null },
      { id: "12", name: "Empate", odd: 3.4, base: null }
    ] },
    { name: "Total de Golos", base: 2.5, selections: [
      { id: "21", name: "Mais de", odd: 1.9, base: 2.5 },
      { id: "22", name: "Menos de", odd: 1.9, base: 2.5 }
    ] },
    { name: "Total de Golos", base: 3.5, selections: [
      { id: "31", name: "Mais de", odd: 3.0, base: 3.5 }
    ] }
  ]
};

test("resolveSelectionIds associa mercado, selecção e linha ao SelectionId da casa", () => {
  const [a, b, c] = resolveSelectionIds(game, [
    { marketName: "Resultado do Jogo", selection: "W1", line: null, odd: 2.1 },
    { marketName: "Total de Golos", selection: "Mais de", line: "3.5", odd: 3.0 },
    { marketName: "Total de Golos", selection: "Mais de", line: "2.5", odd: 2.5 }
  ]);
  assert.deepEqual([a.status, a.selectionId, a.priceChanged], ["ok", "11", false]);
  assert.deepEqual([b.status, b.selectionId], ["ok", "31"]);
  assert.deepEqual([c.selectionId, c.priceChanged, c.currentPrice], ["21", true, 1.9]);
});

test("resolveSelectionIds não adivinha quando falta ou há ambiguidade", () => {
  const [missing, ambiguous] = resolveSelectionIds(game, [
    { marketName: "Ambas Marcam", selection: "Sim", line: null, odd: 1.8 },
    { marketName: "Total de Golos", selection: "Mais de", line: null, odd: 1.9 }
  ]);
  assert.equal(missing.status, "not_found");
  assert.equal(ambiguous.status, "not_found");
  const dup = { markets: [{ name: "X", base: null, selections: [{ id: "1", name: "A", odd: 2, base: null }, { id: "2", name: "A", odd: 2, base: null }] }] };
  assert.equal(resolveSelectionIds(dup, [{ marketName: "X", selection: "A", line: null, odd: 2 }])[0].status, "ambiguous");
});
