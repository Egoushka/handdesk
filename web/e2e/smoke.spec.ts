import { expect, test } from "@playwright/test";

// A stand-in for the Quest's WebXR: it records what the page asks for, then refuses so no session is needed.
const EMULATOR = `
  window.__xrRequests = [];
  const xr = {
    isSessionSupported: async () => true,
    requestSession: async (mode, init) => {
      window.__xrRequests.push({ mode, init: JSON.parse(JSON.stringify(init || {})) });
      throw new DOMException("emulated headset", "NotSupportedError");
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(navigator, "xr", { value: xr, configurable: true });
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(EMULATOR);
});

test("the page loads and offers both modes when WebXR is present", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("handdesk");
  await expect(page.locator("#enter-ar")).toBeEnabled();
  await expect(page.locator("#enter-vr")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Enter AR requests immersive-ar with hand-tracking", async ({ page }) => {
  await page.goto("/");
  await page.locator("#enter-ar").click();
  await expect.poll(() => page.evaluate(() => (window as any).__xrRequests.length)).toBe(1);
  const req = await page.evaluate(() => (window as any).__xrRequests[0]);
  expect(req.mode).toBe("immersive-ar");
  const features = [...(req.init.requiredFeatures ?? []), ...(req.init.optionalFeatures ?? [])];
  expect(features).toContain("hand-tracking");
  expect(features).toContain("local-floor");
  await expect(page.locator("#status")).toContainText("Could not start immersive-ar");
});

test("Enter VR requests immersive-vr with hand-tracking", async ({ page }) => {
  await page.goto("/");
  await page.locator("#enter-vr").click();
  await expect.poll(() => page.evaluate(() => (window as any).__xrRequests.length)).toBe(1);
  const req = await page.evaluate(() => (window as any).__xrRequests[0]);
  expect(req.mode).toBe("immersive-vr");
  expect([...(req.init.optionalFeatures ?? [])]).toContain("hand-tracking");
});

test("without WebXR the buttons are disabled and the page says why", async ({ page }) => {
  await page.addInitScript("Object.defineProperty(navigator, 'xr', { value: undefined, configurable: true });");
  await page.goto("/");
  await expect(page.locator("#enter-ar")).toBeDisabled();
  await expect(page.locator("#status")).toContainText("WebXR is not available");
});

test("without a pairing token the page tells the user which URL to open", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#link")).toContainText("pairing token");
});

test("offers a session through offerSession when the browser has it", async ({ page }) => {
  await page.addInitScript(`
    window.__offers = [];
    navigator.xr.offerSession = (mode, init) => { window.__offers.push({ mode, init: JSON.parse(JSON.stringify(init || {})) }); return new Promise(() => {}); };
  `);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as any).__offers.length)).toBe(1);
  const o = await page.evaluate(() => (window as any).__offers[0]);
  expect(o.mode).toBe("immersive-ar");
  expect(o.init.optionalFeatures).toContain("hand-tracking");
});

test("without offerSession the page shows how to enter", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Press Enter AR");
});
