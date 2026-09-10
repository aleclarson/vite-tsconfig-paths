# Releasing

The release workflow publishes `vite-tsconfig-paths` when a GitHub Release is
published. The GitHub Release tag must be `v` followed by the version in
`package.json`.

The workflow chooses the npm dist-tag from the version:

- A prerelease such as `7.0.0-alpha.2` publishes with the `next` dist-tag.
- A stable version such as `7.0.0` publishes with the `latest` dist-tag.

This means an alpha release changes `next` without moving `latest`.

## One-time setup

Merge the release workflow before configuring npm. npm requires the workflow
file to exist on GitHub.

In the GitHub repository settings, create an environment named `npm`:

1. Add a required reviewer.
2. Under deployment branches and tags, allow only tags matching `v*`.
3. If there is another maintainer available to approve releases, prevent
   self-review.

In the npm settings for `vite-tsconfig-paths`, add a GitHub Actions trusted
publisher with these values:

- Organization or user: `aleclarson`
- Repository: `vite-tsconfig-paths`
- Workflow filename: `release.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The workflow authenticates through GitHub OIDC. Do not add an `NPM_TOKEN`
secret. After one OIDC release succeeds, set npm publishing access to "Require
two-factor authentication and disallow tokens", then revoke any old automation
tokens that are no longer used.

## Release procedure

Start from an up-to-date `master` branch and choose the exact version. This
example prepares the next alpha:

```sh
git switch master
git pull --ff-only origin master
pnpm install --frozen-lockfile
pnpm version 7.0.0-alpha.2 --no-git-tag-version
pnpm fmt:check
pnpm lint
CI=true pnpm test
git diff -- package.json
git add package.json
git commit -m "chore: release v7.0.0-alpha.2"
git tag -a v7.0.0-alpha.2 -m "chore: release v7.0.0-alpha.2"
git push origin master
git push origin v7.0.0-alpha.2
```

Wait for CI on the release commit. Then create a draft GitHub Release from the
existing tag:

```sh
gh release create v7.0.0-alpha.2 --verify-tag --generate-notes --prerelease --draft
```

Review the generated notes and publish the GitHub Release. Approve the `npm`
environment when the release workflow pauses. For a stable release, omit
`--prerelease` when creating the draft. The npm dist-tag still comes from the
version, not from the GitHub prerelease checkbox.

After the workflow finishes, check the dist-tags and provenance:

```sh
npm view vite-tsconfig-paths dist-tags --json
npm view vite-tsconfig-paths@7.0.0-alpha.2 dist.attestations --json
```

## Manual compatibility checks

Run these locally before a stable release; they are not part of CI:

```sh
pnpm check:compat:vite
pnpm check:compat:node
```

The first checks the latest releases of Vite 5, 6, and 7 using your current Node
runtime. The second checks Vite 5–8 using exactly Node 20.20.0. Both build and pack
the plugin, install it with real dependencies in temporary projects, and check
alias resolution in dev and production builds with eager and lazy discovery.
They print the tested versions and fail on installation, resolution, build, or
timeout errors. These are smoke checks, not the full regression suite.

The checks require network access and npm. The minimum-Node check downloads a
local Node binary through the `node` npm package. Temporary projects are removed
on exit; the repository's dependencies and lockfile are unchanged.
