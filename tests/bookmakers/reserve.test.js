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
