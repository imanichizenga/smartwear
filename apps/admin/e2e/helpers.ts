import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { totp } from './totp';

export const EMAIL = process.env.ADMIN_EMAIL ?? 'owner@smartwear.local';
export const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
export const SECRET_FILE = process.env.TOTP_SECRET_FILE ?? '.totp-secret';

/** Password → (enrol or verify) TOTP → signed in. Waits out the 30s window if the code was just used. */
export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  const setup = page.getByText('Secure your account');
  const verify = page.getByText("Confirm it's you");
  await expect(setup.or(verify)).toBeVisible();
  let secret: string;
  if (await setup.isVisible()) {
    secret = (await page.locator('button.font-mono').innerText()).trim();
    writeFileSync(SECRET_FILE, secret);
  } else {
    if (!existsSync(SECRET_FILE)) throw new Error('Admin already has 2FA; set TOTP_SECRET_FILE');
    secret = readFileSync(SECRET_FILE, 'utf8').trim();
  }
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(totp(secret), { delay: 20 });
  if (await setup.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /saved them/ }).click();
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
