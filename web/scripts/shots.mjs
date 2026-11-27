// node scripts/shots.mjs <outdir> [name=query ...]: screenshots of src/ui/preview.ts through vite dev + headless Chromium (software GL)
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "../scratch/shots";
mkdirSync(out, { recursive: true });
const shots = Object.fromEntries(process.argv.slice(3).map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));
const defaults = {
  "mode": "s=deck&tab=mode&hover=mode:trackpad",
  "windows": "s=deck&tab=windows&hover=win:2",
  "windows-empty": "s=deck&tab=windows&windows=0",
  "snips": "s=deck&tab=snips",
  "hands": "s=deck&tab=hands",
  "distance": "s=deck&tab=distance&hover=closer",
  "help": "s=deck&tab=help",
  "guide1": "s=guide&step=0&hover=gNext",
  "guide5": "s=guide&step=4",
  "sheet": "s=sheet",
  "orb": "s=chip&hover=menu",
  "radial": "s=radial&hover=r:modes",
  "bars": "s=bars&hover=x",
};
const list = Object.keys(shots).length ? shots : defaults;
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 2400, height: 1500 } });
page.on("pageerror", (e) => console.error("pageerror", e.message));
for (const [name, query] of Object.entries(list)) {
  await page.goto(`http://127.0.0.1:5199/${query.startsWith("page=") ? query.slice(5) : "preview.html?" + query}`);
  await page.waitForFunction(() => window.__done === true);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
await browser.close();
await server.close();
