# Cloud development for chat-on-steroids-with-my-twist

This fork currently uses the official **TypeScript / Electron** implementation. There is **no Rust migration** yet.

## Default policy

- `main` is the stable integration branch. Work on feature branches and review changes through pull requests.
- The inherited full `CI` suite and `Canary` release are **manual only** in this fork; they are not required for every push.
- The inherited `PR checklist` jobs are gated to the upstream repository. This fork uses optional checks instead.
- The `Fork Cloud Development` workflow runs **only when manually triggered**, either on Linux for typechecks/unit tests or on native Windows for an x64 installer.
- Upstream's other workflows are retained for merge compatibility; many already use an upstream-repository guard. Do **not** run the official publish workflow for this fork without separately adapting branding, download URLs, signing, secrets and release metadata.
- The build produces an **unsigned** Windows installer. Test it before trusting or distributing it.

## Work without a local PC

1. On GitHub, open the fork and choose **Code → Codespaces → Create codespace on main** (or a feature branch). Its Linux container installs Node 22 and runs `npm ci`.
2. Edit on a feature branch. Run `npm run typecheck` and focused `npx vitest run <test-file>` locally in the Codespace as appropriate.
3. Before committing, run `npm run verify:privacy`; do not commit credentials or personal paths. Run `npm run verify` before important merges when practical.
4. For cloud validation or a native Windows installer, open **Actions → Fork Cloud Development → Run workflow**. Choose `checks` or `windows-installer`, then select the branch.
5. Download a successful installer from the workflow run's **Artifacts**. It expires after three days. The Windows job packages and smoke-tests the runtime, but this does **not** replace interactive desktop testing on Windows.
6. Close or stop Codespaces when not in use. Codespaces has a monthly free allowance, not unlimited free compute or storage; check GitHub billing settings.

### Upstream updates

The fork retains its GitHub fork ancestry so you can use GitHub's **Sync fork** controls, or sync through a Codespace:

```sh
git remote add upstream https://github.com/totec448-spec/chat-on-steroids.git
git fetch upstream
git switch -c sync/upstream-$(date +%Y%m%d) main
git merge --no-ff upstream/main
# Resolve only genuine conflicts and run the appropriate tests.
git push -u origin HEAD
```

If `upstream` is already configured, skip `git remote add upstream`. Open a PR from that sync branch into `main`. Never force-push `main` to match upstream: that would discard custom work. After merging upstream, verify the manual-only workflow triggers remain manual, because upstream merges can modify them. Avoid maintaining a broad patched copy of upstream files where a separate fork-only file will do.

### Limitations

- Codespaces uses Linux and does not provide a native Windows GUI session.
- Standard GitHub-hosted Actions runners are available for public repositories, but storage, retention and quotas still need monitoring.
- Browser/ChatGPT integration and Windows desktop controls still need real integration testing. A cloud build does not prove they work.
- The upstream app and extension use official download/update endpoints in places. This fork does not yet rewrite them; do not assume a locally built installer will receive fork-specific updates.
