import test from "node:test";
import assert from "node:assert/strict";
import { extractBookingId, kickoffMillis } from "../../api/bookmakers/reserve.js";

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
