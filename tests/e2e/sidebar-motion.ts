import { test, expect, type Page } from '@playwright/test';

/** Observe the rendered title throughout a toggle, including a mid-flight reversal. */
export async function verifySidebarMotion(page: Page) {
  const toggle = page.locator('.global-sidebar-toggle button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const endpoints: number[] = [];
  for (const mode of ['close', 'open', 'reverse']) {
    const samples = await page.evaluate(async (mode) => {
      const button = document.querySelector<HTMLButtonElement>('.global-sidebar-toggle button')!;
      const position = () => document.querySelector('.header-path')!.getBoundingClientRect().x;
      const points = [position()];
      const start = performance.now();
      let reversed = false;
      button.click();
      // Hidden test windows get sparse frames, so the spring may only start on a late frame:
      // sample until the title stops moving instead of for a fixed window.
      const settled = () =>
        points.length > 2 &&
        Math.abs(points.at(-1)! - points.at(-2)!) < 0.01 &&
        (mode === 'reverse' || Math.abs(points.at(-1)! - points[0]) > 1);
      while (performance.now() - start < 950 || !settled()) {
        if (performance.now() - start > 8000) throw new Error('Sidebar motion did not settle');
        await new Promise(requestAnimationFrame);
        points.push(position());
        if (mode === 'reverse' && !reversed && performance.now() - start >= 90) {
          button.click();
          reversed = true;
        }
      }
      return points;
    }, mode);
    if (mode === 'close') endpoints.push(samples[0], samples.at(-1)!);
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index]).toBeGreaterThanOrEqual(Math.min(...endpoints) - 0.1);
      expect(samples[index]).toBeLessThanOrEqual(Math.max(...endpoints) + 0.1);
      if (mode !== 'reverse') {
        const backward =
          mode === 'close'
            ? samples[index] - samples[index - 1]
            : samples[index - 1] - samples[index];
        expect(backward).toBeLessThan(0.1);
      }
    }
    await expect(toggle).toHaveAttribute('aria-expanded', mode === 'close' ? 'false' : 'true');
    await test.info().attach(`sidebar-${mode}-frames`, {
      body: JSON.stringify({ unit: 'CSS pixels', endpoints, samples }, null, 2),
      contentType: 'application/json',
    });
  }
  await expect
    .poll(async () => (await page.locator('.sidebar-frame').boundingBox())!.width)
    .toBe(264);
}
