import assert from "node:assert/strict";
import test from "node:test";
import { historyDateTimeLabel, historyText } from "./care-ui";

test("history shows declared UTC timestamps as São Paulo date and time", () => {
  const stored = "Pessoa cuidada registrou um cuidado. Horário informado: 2026-10-23T16:43:22.807Z.";
  assert.equal(historyText(stored), "Pessoa cuidada registrou um cuidado. Horário informado: 23/10/2026 às 13:43.");
});

test("history handles the previous local date and equivalent offsets", () => {
  assert.equal(historyDateTimeLabel("2026-10-23T01:15:00.000Z"), "22/10/2026 às 22:15");
  assert.equal(historyDateTimeLabel("2026-10-23T13:43:00-03:00"), "23/10/2026 às 13:43");
});

test("history leaves other text and invalid date evidence intact", () => {
  assert.equal(historyText("Plano conferido."), "Plano conferido.");
  assert.equal(historyDateTimeLabel("invalid"), "invalid");
  assert.equal(historyText("Horário informado: 2026-99-99T16:43:00Z."), "Horário informado: 2026-99-99T16:43:00Z.");
});
