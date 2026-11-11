/**
 * Screenshot every admin page at 1440px and 390px (light + dark) into docs/screenshots/admin.
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… TOTP_SECRET_FILE=… tsx e2e/shoot.ts [/path …]
 */
import { chromium, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { totp } from './totp';

const BASE = process.env.ADMIN_URL ?? 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL ?? 'owner@smartwear.local';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const SECRET_FILE = process.env.TOTP_SECRET_FILE ?? '.totp-secret';
const OUT = process.env.SHOT_DIR ?? join(process.cwd(), '..', '..', 'docs', 'screenshots', 'admin');
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['/'];

async function typeCode(page: Page, code: string) {
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code, { delay: 30 });
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.screenshot({ path: join(OUT, 'login-1440-light.png') });
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  const setup = page.getByText('Secure your account');
  const verify = page.getByText("Confirm it's you");
  await Promise.race([setup.waitFor(), verify.waitFor()]);
  if (await setup.isVisible()) {
    const key = (await page.locator('button.font-mono').innerText()).trim();
    writeFileSync(SECRET_FILE, key);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, 'login-mfa-setup-1440-light.png') });
    await typeCode(page, totp(key));
    await page.getByText('Save your recovery codes').waitFor();
    await page.getByRole('button', { name: /saved them/ }).click();
  } else {
    if (!existsSync(SECRET_FILE)) throw new Error('2FA already enrolled but no TOTP secret file');
    await typeCode(page, totp(readFileSync(SECRET_FILE, 'utf8').trim()));
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

const slug = (p: string) => (p === '/' ? 'dashboard' : p.replace(/^\//, '').replace(/[/?=&]+/g, '-'));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await signIn(page);
  for (const p of PAGES) {
    for (const theme of ['light', 'dark'] as const) {
      await ctx.addCookies([{ name: 'sw_theme', value: theme, url: BASE }]);
      for (const [w, h] of [[1440, 960], [390, 844]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(700);
        const file = join(OUT, `${slug(p)}-${w}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: w === 1440 });
        console.log('shot', file);
      }
    }
  }
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
