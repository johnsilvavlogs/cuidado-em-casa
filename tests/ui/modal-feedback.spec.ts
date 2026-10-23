import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

const base = process.env.TEST_BASE_URL;
if (!base) throw new Error("Set TEST_BASE_URL to a running local application.");

test("a new modal owns only feedback from actions started after opening", async ({ page }) => {
  await page.goto(base);
  await page.getByRole("button", { name: "Explorar rotina de demonstração", exact: true }).click();
  await page.getByRole("button", { name: "Não consegui", exact: true }).click();
  await page.getByRole("button", { name: "Salvar registro", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Ajuda urgente", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajuda urgente", exact: true });
  await expect(page.locator(".action-toast")).toContainText("Dificuldade registrada");
  await expect(dialog.locator(".modal-feedback")).toHaveCount(0);

  let rejectSave!: () => void;
  const saveReady = new Promise<void>((resolve) => { rejectSave = resolve; });
  await page.route("**/api/actions", async (route) => {
    await saveReady;
    await route.fulfill({ status: 422, json: { error: "Falha de teste ao salvar o pedido." } });
  }, { times: 1 });
  await dialog.getByRole("button", { name: "Enviar pedido urgente", exact: true }).click();
  await expect(dialog.locator(".modal-feedback")).toHaveText("Salvando…");
  rejectSave();
  await expect(dialog.getByRole("alert")).toContainText("Falha de teste ao salvar o pedido.");
  await expect(dialog.getByRole("button", { name: "Enviar pedido urgente", exact: true })).toBeEnabled();

  await dialog.getByRole("button", { name: "Enviar pedido urgente", exact: true }).click();
  await expect(dialog.locator(".modal-feedback")).toHaveText("Pedido urgente salvo.");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Pedido urgente salvo", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Ajuda urgente", exact: true }).click();
  await expect(dialog.locator(".modal-feedback")).toHaveCount(0);
});
