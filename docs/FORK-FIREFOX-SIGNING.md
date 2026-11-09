# Unlisted Firefox signing for the BrodXI CoS fork

This is **self-distribution / unlisted** signing only. The extension is not published in Mozilla's public add-on directory. All submissions still go to Mozilla for automated checks and possible review.

## Add-on identity and release versions

- Fork-specific Firefox ID: `companion@brodxi.local`.
- The current app version is read from `package.json`. Firefox uses an additional fourth numeric component (for example `2.1.51.1`), because Mozilla will not accept the same version twice for an add-on.
- The signing workflow deliberately removes the upstream `update_url`. Signed versions do not silently install another project's updates.
- Do not run the inherited `firefox-sign-check.yml` or upstream publish workflow to sign this fork. Those use upstream's identity/update addresses.

## Rebuild the submitted extension from this source archive

Requires Node.js 22+, npm, and this archive's `package-lock.json`.

```bash
npm ci
node scripts/build-fork-browser-extensions.mjs
```

The generated Firefox folder is `release/firefox-extension`; it contains the shared extension scripts plus a Gecko-specific manifest and `build-stamp.txt`. The GitHub workflow then sets `manifest.json` version to `<package.json version>.<build number>` using the `Prepare fork Firefox signing version` step in `.github/workflows/fork-firefox-sign.yml`. The folder is then validated and submitted to AMO with `web-ext sign --channel=unlisted`.

All JavaScript extension source files are kept readable. No webpack, bundler, minifier, or obfuscator is used. The build writes the build stamp and derives a Firefox manifest; the rest of the JavaScript is copied unchanged. The source archive supplied to Mozilla includes `extension/`, `scripts/`, `package.json`, `package-lock.json`, this document, and `LICENSE`.

## To sign through GitHub Actions

1. Sign in to https://addons.mozilla.org/developers/ and use **Manage API Keys** to create Mozilla API credentials. The Mozilla account must own the extension ID if it was previously submitted.
2. Add the credentials as encrypted secrets in this GitHub repository, **Settings → Secrets and variables → Actions**: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Never commit or paste the values into chat.
3. Open **Actions → Sign Firefox add-on (unlisted, fork) → Run workflow**, choose the `main` branch and a *new* Firefox build number, and submit the run.
4. The job checks the manifest identity and version, lints the package, uploads the human-readable source archive, and requests **unlisted** signing. If Mozilla signs the add-on, download the signed `.xpi` from the workflow's artifact. It may first need Mozilla review.

A signing failure does **not** make the extension public. If the job reports missing credentials, add the two secrets and re-run. If Mozilla reports a duplicate version, increment the Firefox build number. Temporary Firefox installations through `about:debugging` continue to work without signing.
