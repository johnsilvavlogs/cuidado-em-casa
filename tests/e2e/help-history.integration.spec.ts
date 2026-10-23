import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { CareRepository } from "../../src/lib/server/care-repository";
import { dateInBrazil } from "../../src/lib/server/care-domain";
import type { CareState } from "../../src/lib/contracts";

test("mobile-help-keeps-care-and-source-after-day-change", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = new Date(`${dateInBrazil(new Date())}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const yesterday = date.toISOString().slice(0, 10);
  const repository = new CareRepository({ now: () => new Date(`${yesterday}T23:59:00-03:00`) });
  const patient = await repository.startDemo({ scenario: "ready", role: "patient" });
  const task = patient.state.tasks.find(item => item.title === "Caminhada leve")!;
  const requested = await repository.mutate(patient.token, {
    type: "request_help", taskId: task.id, message: "Preciso de ajuda para caminhar.", urgent: false, requestId: randomUUID(),
  }, { demoId: patient.state.demoId, role: "patient" });
  await repository.close();

  await page.goto(`/?demo=${patient.state.demoId}&role=caregiver`);
  await expect(page.getByRole("heading", { name: "Acompanhamento de Helena", exact: true })).toBeVisible();
  const response = await page.request.get("/api/state");
  expect(response.status()).toBe(200);
  const state = await response.json() as CareState;
  expect(state.tasks.every(item => item.referenceDate === dateInBrazil(new Date()))).toBe(true);
  expect(state.tasks.some(item => item.id === task.id)).toBe(false);
  expect(state.helpRequests[0].task).toMatchObject({ title: task.title, itemId: task.itemId, referenceDate: yesterday });
  await expect(page.locator('[data-parity-anchor="help-card"]')).toContainText("Caminhada leve");
  await page.getByRole("button", { name: "Ver relato", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Preciso de ajuda para caminhar.");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Caminhada leve", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Ver orientação", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Caminhada leve");
  await expect(page.getByRole("dialog")).toContainText("se estiver confortável");
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Ver relato", exact: true }).click();
  await page.getByRole("button", { name: "Marcar como resolvido", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Ajuda resolvida");
  await page.reload();
  await page.getByRole("button", { name: "Ver pedidos", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Caminhada leve");
  await expect(page.getByRole("dialog")).toContainText("Ajuda resolvida");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Ver orientação", exact: true })).toBeVisible();
  const saved = await (await page.request.get("/api/state")).json() as CareState;
  expect(saved.tasks.every(item => item.status === "pending")).toBe(true);
  expect(saved.helpRequests[0].id).toBe(requested.helpRequests[0].id);
  await mkdir("output/e2e/help-history", { recursive: true });
  await page.screenshot({ path: "output/e2e/help-history/resolved.png" });
  await writeFile("output/e2e/help-history/receipt.json", JSON.stringify({ caseId: saved.demoId, result: "passed", yesterday, currentDate: dateInBrazil(new Date()), assertions: ["today list excludes prior task", "old help retains title and item source", "source opens through UI", "resolution persists", "today tasks stay pending"] }, null, 2));
  await info.attach("help-history", { path: "output/e2e/help-history/receipt.json", contentType: "application/json" });
});
