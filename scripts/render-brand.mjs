// Renders the brand PNGs from the HTML/SVG sources in brand/ using headless Chrome.
// Usage: node scripts/render-brand.mjs   (set CHROME=/path/to/chrome if it isn't found)
// Output: brand/avatar.png, brand/banner.png, brand/social/<repo>.png
//
// --changed renders only the social images whose inputs (description, colour) differ from
// brand/social/manifest.json, or that don't exist yet, and leaves every other committed PNG
// alone. The workflow uses it, because the same page rasterises differently on Linux and
// Windows, so a full re-render would rewrite every image on each run. (--new-only is an
// older name for the same thing.)
//
// The manifest also remembers each repo's accent colour, so a card keeps its colour when
// it is re-rendered or when other repos are added.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORG = process.env.ORG ?? "freeknet";
const TOKEN = process.env.GITHUB_TOKEN;
const CHANGED_ONLY = process.argv.includes("--changed") || process.argv.includes("--new-only");
const SKIP = new Set([".github"]);
// Accent colours for repos the manifest doesn't know yet. New repos cycle through COLOURS.
const PINNED = {
  "create-rust-app": "#FF8A65",
  rustaman: "#6FD3FF",
  metaplate: "#D7A6FF",
  "juce-plugin-example": "#FFD84A",
  rustdirstat: "#5CF2C8",
};
const COLOURS = ["#FF8AC8", "#B8F84A"];

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found; set CHROME to its path");

const brand = resolve("brand");

function shoot(url, out, width, height, scale) {
  execFileSync(chrome, [
    "--headless=new",
    // Ubuntu's AppArmor policy stops Chrome's sandbox from starting on GitHub's runners.
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "--disable-gpu",
    "--hide-scrollbars",
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    "--virtual-time-budget=8000",
    `--screenshot=${out}`,
    url,
  ], { stdio: "ignore" });
  console.log(`wrote ${out}`);
}

const fileUrl = (name) => pathToFileURL(resolve(brand, name)).href;

if (!CHANGED_ONLY) {
  shoot(fileUrl("avatar.svg"), resolve(brand, "avatar.png"), 512, 512, 1);
  shoot(fileUrl("banner.html"), resolve(brand, "banner.png"), 1200, 300, 2);
}

const res = await fetch(`https://api.github.com/orgs/${ORG}/repos?type=public&per_page=100`, {
  headers: {
    Accept: "application/vnd.github+json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  },
});
if (!res.ok) throw new Error(`listing repos failed: ${res.status}`);
const repos = (await res.json())
  .filter((r) => !r.private && !r.archived && !r.fork && !SKIP.has(r.name))
  .sort((a, b) => a.created_at.localeCompare(b.created_at));

const social = resolve(brand, "social");
const manifestPath = resolve(social, "manifest.json");
mkdirSync(social, { recursive: true });
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const manifest = {};
let next = Object.values(previous).filter((e) => COLOURS.includes(e.color)).length;
for (const r of repos) {
  const desc = r.description ?? "";
  const color = previous[r.name]?.color ?? PINNED[r.name] ?? COLOURS[next++ % COLOURS.length];
  manifest[r.name] = { color, desc };

  const out = resolve(social, `${r.name}.png`);
  const unchanged = existsSync(out) && previous[r.name]?.desc === desc && previous[r.name]?.color === color;
  if (CHANGED_ONLY && unchanged) continue;
  const q = new URLSearchParams({ repo: r.name, desc, color });
  shoot(`${fileUrl("social.html")}?${q}`, out, 1280, 640, 1);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
