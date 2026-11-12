# Fork app updater and official upstream notices

CoS now uses two independent release sources:

- **App updates:** `BrodXI/chat-on-steroids-with-my-twist`. The existing app updater checks at startup and every six hours, downloads a verified Windows x64 installer (or supported AppImage), and offers **Install now**. Without explicit Install, a staged update is handed off only when the app quits. It never installs from the official upstream repository.
- **Upstream notification:** `totec448-spec/chat-on-steroids`. Checked on startup and hourly, without downloading anything from upstream. A slim, dismissible banner appears at the top of the workspace only when the official version exceeds this fork's integrated base version. **View changes** opens the official release page. Dismissing a version hides only that version.

## Publishing a fork update

1. Build the installer and Chrome extension from an exact Git commit on a fork branch that descends from the previous shipped commit.
2. Publish a GitHub release in the fork with its **full 40-character source SHA** as `target_commitish`. Pre-release tags such as `cos-fork-update-preview-<sha>` are supported; the updater does not require `vX.Y.Z` tags.
3. Attach `Chat-On-Steroids-Setup-x64.exe` and any other supported assets. GitHub must expose their `sha256:<64 hexadecimal characters>` digests. The existing Windows install smoke test should pass before publishing.
4. Publish a Mozilla-signed Firefox `.xpi`, never an unsigned development ZIP. Recovery of Chrome/Firefox add-ons searches only the release built from the installed app's exact commit, so it cannot accidentally serve a newer incompatible bridge protocol.

The updater embeds its own source SHA during the Electron build. It compares release commits through GitHub's `/compare` API and accepts only **ahead**, never an identical, behind, or diverged commit. The downloaded executable must match GitHub's published SHA-256 before it can be staged or executed. If the app was packaged without a source SHA, it cannot automatically select fork preview releases and will not guess a checkout.

For unsupported OS/architecture packages or releases that omit an installer for that machine, the app opens the relevant fork release page for manual download. A fork release does not automatically merge changes from upstream; the upstream notice is informational only.
