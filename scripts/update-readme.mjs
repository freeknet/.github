// Regenerates the generated blocks in profile/README.md from the org's public repos.
// Usage: GITHUB_TOKEN=... node scripts/update-readme.mjs
// Env: ORG (default "freeknet"), README (default "profile/README.md").
//
// Each block sits between <!-- GEN:<name>:START --> and <!-- GEN:<name>:END --> markers:
//   stats    - project, fork and star counts and the main languages, under the header
//   projects - the org's own repos as tables, grouped by category (scripts/readme.config.json)
//   forks    - forked repos with their upstream and how far ahead of it they are
// Everything outside the markers is hand-written and left alone.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ORG = process.env.ORG ?? "freeknet";
const README = process.env.README ?? "profile/README.md";
const TOKEN = process.env.GITHUB_TOKEN;
const CONFIG = JSON.parse(await readFile(resolve("scripts/readme.config.json"), "utf8"));

const SKIP = new Set(CONFIG.skip ?? []);

// Friendlier names for the stack line. null hides a language. Anything not listed is shown as-is.
const LANGUAGE_NAMES = {
  JavaScript: "Node",
  Shell: null, // build glue, not worth showing
  PowerShell: null,
  Batchfile: null,
  Makefile: null,
  Dockerfile: null,
  HTML: null,
  CSS: null,
};
const MAX_LANGUAGES = 3;

async function gh(path, { allow404 = false } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (allow404 && (res.status === 404 || res.status === 422)) return null;
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
  // Newest first. created_at never changes, so the order is stable between runs.
  return repos
    .filter((r) => !r.private && !r.archived && !SKIP.has(r.name))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name));
}

// ---------- formatting helpers ----------

const escapeHtml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const cell = (text) => escapeHtml(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

function ensureSentence(text) {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function compact(n) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

// ---------- data ----------

function stackFrom(languages) {
  const names = Object.entries(languages)
    .sort(([, a], [, b]) => b - a)
    .map(([lang]) => (lang in LANGUAGE_NAMES ? LANGUAGE_NAMES[lang] : lang))
    .filter(Boolean);
  return [...new Set(names)].slice(0, MAX_LANGUAGES);
}

async function enrichProject(repo) {
  const [languages, release] = await Promise.all([
    gh(`/repos/${ORG}/${repo.name}/languages`),
    gh(`/repos/${ORG}/${repo.name}/releases/latest`, { allow404: true }),
  ]);
  return { ...repo, stack: stackFrom(languages), release };
}

async function enrichFork(repo) {
  // The org listing leaves out `parent`, so fetch the repo itself.
  const full = await gh(`/repos/${ORG}/${repo.name}`);
  const parent = full.parent;
  let compare = null;
  if (parent) {
    const basehead = `${parent.owner.login}:${parent.default_branch}...${ORG}:${full.default_branch}`;
    compare = await gh(`/repos/${ORG}/${repo.name}/compare/${encodeURIComponent(basehead)}?per_page=1`, {
      allow404: true,
    });
  }
  return { ...full, parent, compare };
}

function categoryFor(repo) {
  const override = CONFIG.categoryOverrides?.[repo.name];
  if (override) {
    const named = CONFIG.categories.find((c) => c.title === override);
    if (named) return named;
  }
  const topics = new Set(repo.topics ?? []);
  return CONFIG.categories.find((c) => c.topics.some((t) => topics.has(t))) ?? CONFIG.fallbackCategory;
}

// ---------- blocks ----------

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function renderStats(projects, forks) {
  const stars = projects.reduce((sum, r) => sum + r.stargazers_count, 0);
  const orgUrl = `https://github.com/orgs/${ORG}/repositories`;

  // Primary languages, most common first.
  const counts = new Map();
  for (const r of projects) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  const languages = [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([l]) => l);

  const parts = [
    `<a href="${orgUrl}?type=source"><b>${projects.length}</b> projects</a>`,
    forks.length ? `<a href="${orgUrl}?type=fork"><b>${forks.length}</b> forks</a>` : null,
    stars ? `<b>${compact(stars)}</b> stars` : null,
    languages.length ? `written in ${joinList(languages.map(escapeHtml))}` : null,
  ].filter(Boolean);
  return `<p>${parts.join(" &nbsp;·&nbsp; ")}</p>`;
}

function renderProjectRow(repo) {
  const facts = [
    repo.release ? `<a href="${repo.release.html_url}">${escapeHtml(repo.release.tag_name)}</a>` : null,
    repo.stargazers_count ? `★ ${compact(repo.stargazers_count)}` : null,
  ].filter(Boolean);
  const name = `[**${cell(repo.name)}**](${repo.html_url})${facts.length ? `<br><sub>${facts.join(" · ")}</sub>` : ""}`;

  const desc = repo.description ? cell(ensureSentence(repo.description)) : "_No description yet._";
  const site = repo.homepage ? ` [Website](${repo.homepage})` : "";
  const stack = repo.stack.length ? cell(repo.stack.join(" · ")) : "—";
  const spdx = repo.license?.spdx_id;
  const license = spdx && spdx !== "NOASSERTION" ? `<br><sub>${cell(spdx)}</sub>` : "";
  return `| ${name} | ${desc}${site} | ${stack}${license} |`;
}

function renderProjects(projects) {
  const order = [...CONFIG.categories, CONFIG.fallbackCategory];
  const groups = new Map(order.map((c) => [c.title, []]));
  for (const r of projects) groups.get(categoryFor(r).title).push(r);

  const sections = [];
  for (const category of order) {
    const repos = groups.get(category.title);
    if (!repos.length) continue;
    sections.push(
      [
        `### ${category.title}`,
        "",
        ...(category.blurb ? [category.blurb, ""] : []),
        "| Project | What it does | Stack |",
        "| --- | --- | --- |",
        ...repos.map(renderProjectRow),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

function forkStatus(fork) {
  const c = fork.compare;
  if (!c) return "—";
  if (c.ahead_by > 0) {
    const commits = `${c.ahead_by} commit${c.ahead_by === 1 ? "" : "s"} ahead`;
    return `[${commits}](${c.html_url})`;
  }
  return "Tracking upstream";
}

function renderForks(forks) {
  if (!forks.length) return "_No forks yet._";
  const rows = forks.map((f) => {
    const p = f.parent;
    const upstream = p ? `[${cell(p.full_name)}](${p.html_url})<br><sub>★ ${compact(p.stargazers_count)}</sub>` : "—";
    const desc = f.description ?? p?.description;
    const note = CONFIG.forkNotes?.[f.name];
    // forkNotes come from our own config, so they may contain inline markdown.
    const what = (desc ? cell(ensureSentence(desc)) : "_No description._") + (note ? `<br><sub>${cell(note)}</sub>` : "");
    const language = f.language ?? p?.language;
    const name = `[**${cell(f.name)}**](${f.html_url})${language ? `<br><sub>${cell(language)}</sub>` : ""}`;
    return `| ${name} | ${upstream} | ${what} | ${forkStatus(f)} |`;
  });
  return ["| Fork | Upstream | What it is | Our changes |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

// ---------- README splicing ----------

function replaceBlock(readme, name, content) {
  const start = new RegExp(`<!-- GEN:${name}:START[^>]*-->`);
  const end = `<!-- GEN:${name}:END -->`;
  const startMatch = readme.match(start);
  const endIndex = readme.indexOf(end);
  if (!startMatch || endIndex === -1 || endIndex < startMatch.index) {
    throw new Error(`${README} is missing the GEN:${name}:START / GEN:${name}:END markers`);
  }
  const head = readme.slice(0, startMatch.index + startMatch[0].length);
  return `${head}\n${content}\n${readme.slice(endIndex)}`;
}

const repos = await listRepos();
const [projects, forks] = await Promise.all([
  Promise.all(repos.filter((r) => !r.fork).map(enrichProject)),
  Promise.all(repos.filter((r) => r.fork).map(enrichFork)),
]);

const readme = await readFile(README, "utf8");
let updated = readme;
updated = replaceBlock(updated, "stats", renderStats(projects, forks));
updated = replaceBlock(updated, "projects", renderProjects(projects));
updated = replaceBlock(updated, "forks", renderForks(forks));

if (updated === readme) {
  console.log("README already up to date.");
} else {
  await writeFile(README, updated);
  console.log("README updated.");
}
