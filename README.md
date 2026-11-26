# .github

Organization-wide files for [freeknet](https://github.com/freeknet).

- [`profile/README.md`](profile/README.md) is the profile shown at github.com/freeknet. The blocks between `GEN:*` markers are generated; everything else is hand-written.
- [`scripts/readme.config.json`](scripts/readme.config.json) controls the generated parts: which repos to skip, the project categories (matched by repo topics, first match wins), per-repo category overrides and optional notes for forks.
- [`scripts/update-readme.mjs`](scripts/update-readme.mjs) fills in the stats badges, the project cards and the forks table from the GitHub API.
- [`scripts/render-brand.mjs`](scripts/render-brand.mjs) renders the banner, avatar and per-repo social cards. `brand/social/manifest.json` records what each card was rendered from, so a card is re-rendered when its repo's description changes.
- [`.github/workflows/update-readme.yml`](.github/workflows/update-readme.yml) runs both scripts every 6 hours and commits any changes.

To put a new repo in a category, give it one of that category's topics on GitHub, or add it to `categoryOverrides`.
