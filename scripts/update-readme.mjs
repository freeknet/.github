// Regenerates the Projects table in profile/README.md from the org's public repos.
// Usage: GITHUB_TOKEN=... node scripts/update-readme.mjs
// Env: ORG (default "freeknet"), README (default "profile/README.md").

import { readFile, writeFile } from "node:fs/promises";

const ORG = process.env.ORG ?? "freeknet";
const README = process.env.README ?? "profile/README.md";
const TOKEN = process.env.GITHUB_TOKEN;

const START = /<!-- PROJECTS:START[^>]*-->/;
const END = "<!-- PROJECTS:END -->";

// Repos never listed in the table.
const SKIP = new Set([".github"]);

// Friendlier names for the Stack column. Anything not listed is shown as-is.
const LANGUAGE_NAMES = {
  JavaScript: "Node",
  TypeScript: "TypeScript",
  Shell: null, // build glue, not worth showing
  PowerShell: null,
  Makefile: null,
  Dockerfile: null,
  HTML: null,
  CSS: null,
};

const MAX_LANGUAGES = 3;

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/orgs/${ORG}/repos?type=public&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos
    .filter((r) => !r.private && !r.archived && !r.fork && !SKIP.has(r.name))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name));
}

async function stackFor(repo) {
  const languages = await gh(`/repos/${ORG}/${repo.name}/languages`);
  const names = Object.entries(languages)
    .sort(([, a], [, b]) => b - a)
    .map(([lang]) => (lang in LANGUAGE_NAMES ? LANGUAGE_NAMES[lang] : lang))
    .filter(Boolean);
  const unique = [...new Set(names)].slice(0, MAX_LANGUAGES).sort();
  return unique.join(" · ") || "—";
}

const cell = (text) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

function ensureSentence(text) {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

async function buildTable() {
  const repos = await listRepos();
  const rows = await Promise.all(
    repos.map(async (r) => {
      const desc = r.description ? ensureSentence(r.description) : "_No description yet._";
      return `| [**${r.name}**](${r.html_url}) | ${cell(desc)} | ${await stackFor(r)} |`;
    }),
  );
  return ["| Project | What it does | Stack |", "| --- | --- | --- |", ...rows].join("\n");
}

const readme = await readFile(README, "utf8");
const startMatch = readme.match(START);
const endIndex = readme.indexOf(END);
if (!startMatch || endIndex === -1 || endIndex < startMatch.index) {
  throw new Error(`${README} is missing the PROJECTS:START / PROJECTS:END markers`);
}

const head = readme.slice(0, startMatch.index + startMatch[0].length);
const tail = readme.slice(endIndex);
const updated = `${head}\n${await buildTable()}\n${tail}`;

if (updated === readme) {
  console.log("README already up to date.");
} else {
  await writeFile(README, updated);
  console.log("README updated.");
}
