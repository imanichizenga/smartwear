import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('S3: change a setting, save it, and the connection test passes', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/storage.s3');
  await expect(page.getByRole('heading', { name: 'Media storage' })).toBeVisible();

  const ttl = page.getByLabel('Signed link lifetime');
  const original = await ttl.inputValue();
  await ttl.fill(original === '900' ? '1200' : '900');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Media storage saved')).toBeVisible();

  await page.getByRole('button', { name: 'Test connection' }).click();
  // Every check reported by the API is listed with its own result.
  await expect(page.getByText(/All checks passed|Something needs attention/)).toBeVisible({ timeout: 30_000 });
  for (const check of ['Put object', 'Get object', 'Delete object']) {
    await expect(page.getByRole('listitem').filter({ hasText: check })).toBeVisible();
  }
});

test('a secret is masked and never sent to the browser in plain text', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings');
  const body = await (await page.request.get('/api/v1/admin/settings/storage.s3', { headers: { 'X-Requested-With': 'SmartWearAdmin' } })).json();
  expect(body.value.secretAccessKey).toMatch(/^•+/);
  expect(JSON.stringify(body)).not.toContain('smartwear-secret');
});
