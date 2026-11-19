import test from "node:test";
import assert from "node:assert/strict";
import { extractBookingId, kickoffMillis, isKickoffEligible } from "../../api/bookmakers/reserve.js";

test("extrai o bookingId devolvido directamente pela casa", () => {
  assert.equal(extractBookingId({ share: { bookId: 123456 } }), "123456");
});

test("extrai o bookingId do link de reserva quando não há bookId separado", () => {
  assert.equal(extractBookingId({ share: { bookingLink: "https://m.bantubet.co.ao?bookingId=987654" } }), "987654");
  assert.equal(extractBookingId({ share: { bookingLink: "https://m.bantubet.co.ao?bookingId=abc" } }), null);
});

test("interpreta data local Angola no formato dia/mês/ano", () => {
  assert.equal(kickoffMillis("14/11/2026, 18:30"), Date.parse("2026-11-14T17:30:00.000Z"));
  assert.equal(kickoffMillis("14.11.2026, 18:30"), Date.parse("2026-11-14T17:30:00.000Z"));
});

test("aceita qualquer partida que ainda não começou, mesmo dentro de uma hora", () => {
  const now = Date.parse("2026-11-16T15:00:00.000Z");
  assert.equal(isKickoffEligible("2026-11-16T15:01:00.000Z", now), true);
  assert.equal(isKickoffEligible("16/11/2026, 16:30", now), true);
});

test("rejeita partidas que já começaram ou têm hora inválida", () => {
  const now = Date.parse("2026-11-16T15:00:00.000Z");
  assert.equal(isKickoffEligible("2026-11-16T14:59:59.000Z", now), false);
  assert.equal(isKickoffEligible("2026-11-16T15:00:00.000Z", now), false);
  assert.equal(isKickoffEligible("hora inválida", now), false);
});

import { createBooking } from "../../api/bookmakers/reserve.js";
import { createSwarmBooking } from "../../lib/bookmakers/swarm.js";

test("reserva recusa selecções sem selectionId da casa (sem contactar a rede)", async () => {
  await assert.rejects(
    createBooking({ site: "bantu", selections: [{ odd: 1.5 }] }),
    /selectionId/
  );
});

test("reserva recusa odd total que não bate com o produto das odds", async () => {
  await assert.rejects(
    createBooking({ site: "bantu", totalOdd: 9, selections: [{ selectionId: "7455536947", odd: 1.5 }, { selectionId: "7528610932", odd: 1.5 }] }),
    /não corresponde/
  );
});

test("reserva recusa jogos que já começaram", async () => {
  await assert.rejects(
    createBooking({ site: "elephant", selections: [{ selectionId: "7455536947", odd: 1.5, startTime: "2020-01-01T00:00:00.000Z" }] }),
    /ainda não ter começado/
  );
});

test("createSwarmBooking valida os identificadores antes de abrir a ligação", async () => {
  await assert.rejects(createSwarmBooking({ siteId: 1, wsUrl: "wss://x", selections: [] }), /pelo menos uma/);
  await assert.rejects(createSwarmBooking({ siteId: 1, wsUrl: "wss://x", selections: [{ selectionId: "abc", price: 2 }] }), /selectionId numérico/);
  await assert.rejects(createSwarmBooking({ siteId: 1, wsUrl: "wss://x", selections: [{ selectionId: "1", price: 1 }] }), /preço superior/);
});
