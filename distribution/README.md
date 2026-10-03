# Moose Web distribution

Public installer: `https://moose.shqingda.workers.dev/install.sh`.

This guide covers distribution operations for Moose 0.22.1. End-user steps are in
the [Web guide](../docs/web.md); the complete release workflow is maintained in
[Development and packaging](../docs/development.md#发布流程).

The landing page in `distribution/site` uses pnpm, Vite, TanStack Start, and
Tailwind CSS. `pnpm site:build` prerenders it and copies the client assets into
`distribution/public`, preserving the installer, manifest, and published release
archives. Landing-page-only updates can be deployed from that asset directory;
versioned Moose releases still use the joint pipeline below.

The standalone installer supports **macOS Apple Silicon**. It includes official Node.js 24.21.0,
the built Web UI and service, SQLite, and the PTY module. No Electron, system Node,
pnpm, or compiler is required on the target computer. Agent CLIs are installed and
authenticated separately. The local service keeps its data in `~/.moose/web`.

```sh
curl -fsSL https://moose.shqingda.workers.dev/install.sh | sh
# Open a new terminal, then:
moose
moose status
moose stop
```

`moose` / `moose web` opens the browser. `moose start` starts without opening it.
Closing a browser leaves tasks running; `moose stop` stops the service and tasks.
Installation lives in `~/.local/share/moose`, with the command in `~/.local/bin`.
The installer adds this bin directory to standard bash/zsh startup files.

## Update an installation

Run `moose update` to download and verify the latest standalone Web release.
`moose --version` reports the installed version; `moose status` checks the
running service and prints its address and data directory, without a version.
The running service may still use the previous release. Downloads and checksum
failures leave the installation unchanged. Updates keep the running service,
tasks, previous release directories and workspace data intact.

After tasks finish, run `moose stop && moose` to use the installed version and
open the new authenticated link. Versions 0.21.0 and earlier need the installer
run once to gain the update command. This command updates standalone Web
installations; a browser workspace connected to the desktop data directory is updated
with its desktop background service.

## Build and publish

Both hosts must be published with the same `package.json` version. Commit release
notes and code first, then use the joint pipeline:

```sh
pnpm release:prepare
pnpm release:publish
```

The preparation step builds and verifies both packages. Publication refuses a dirty
workspace, a different commit, mismatching versions, or mismatching checksums. It
uploads both packages to a draft GitHub Release, deploys Workers Static Assets,
verifies an installation from the public URL, then publishes the desktop release.
Do not publish a Web-only release using Wrangler directly.

The version comes from `package.json`. The desktop DMG, Web tarball, release
notes and `v<version>` tag all use that version. The Web manifest additionally
identifies the archive by `<version>-<first 12 SHA-256 characters>`, followed by
its complete SHA-256 and part count. This identifier is a build identity, not a
different application version.

The checksums file is `release/Moose-<version>-SHA256SUMS.txt` and covers the DMG
and Web archive. `release/prepared.json` binds both verified packages to the
release commit. The script also checks the packaged app's version before upload.

The packager checks the pinned official Node SHA-256. Installers verify the complete
release SHA-256 before extracting or changing the active version. The active release
switch is atomic. The download files contain only runtime output and dependencies;
no credentials, databases, repository metadata, source maps, or developer configuration.

Workers Static Assets limits each file to 25 MiB, so the archive is served as immutable
20 MiB parts and joined before checksum verification. This uses static hosting without
R2, KV, a database, or Worker request processing. Keep previously published release
parts in `distribution/public/releases` during subsequent deploys so in-progress
installations can finish. Generated packages are gitignored; preserve the published
asset directory in release storage when moving the build to another machine.

## Deployment recovery

If deployment or public installation verification fails, keep the GitHub
Release draft. A switched manifest alone does not prove all release parts are
available. After resolving the failure, rerun `pnpm release:publish` from the
same clean, prepared commit; the script restores the draft workflow, verifies
the public installation again and only then publishes the GitHub Release.

Check the canonical manifest and every referenced part from the repository root:

```sh
curl -fsSL --max-time 15 https://moose.shqingda.workers.dev/latest-darwin-arm64.txt
read -r moose_release_id moose_release_sha256 moose_part_count < distribution/public/latest-darwin-arm64.txt
moose_part_index=0
while [ "$moose_part_index" -lt "$moose_part_count" ]; do
  curl -fsSI --max-time 15 "https://moose.shqingda.workers.dev/releases/$moose_release_id/darwin-arm64/part-$moose_part_index"
  moose_part_index=$((moose_part_index + 1))
done
```

Compare the public manifest with the local one before using the local part
paths. HEAD responses check reachability; the public smoke test still downloads
the complete archive, verifies its checksum and starts the installed service.
New parts can briefly return 404 while a deployment propagates. Retain old
parts, wait for the new paths to become reachable and rerun the release command;
do not skip the public smoke test or publish the draft manually.

A preparation fix or any other release code change needs a new commit and
`pnpm release:prepare` again. An already public version cannot be republished;
change the version for a new package. Documentation-only changes do not replace
existing release files or tags.

## Site assets and favicons

The landing page imports the approved black skeuomorphic icon from
`src/assets/moose-icon-black.png`. `pnpm icon:build` generates both favicon
variants from the unchanged sidebar silhouette: `favicon.svg` is dark and
`favicon-light.svg` is light. The HTML selects them using the system
`prefers-color-scheme` preference, independently of the application's theme.
Run `pnpm site:build` after changing site assets to update the staging directory;
this command does not deploy. Asset ownership is documented in
[Brand resources](../docs/development.md#图标与品牌资源).

## Isolated verification

For isolated tests, use `MOOSE_INSTALL_DIR`, `MOOSE_BIN_DIR`,
`MOOSE_WEB_DATA_DIR`, `MOOSE_NO_MODIFY_PATH=1`, and `MOOSE_NO_OPEN=1`.
`MOOSE_DOWNLOAD_BASE` overrides the distribution origin. The smoke test installs in
a temporary directory with system-only PATH, exercises authenticated requests and a
real terminal command, and cleans up its service and installation.

The preparation smoke test exercises checksum rejection with a deliberately
corrupted local manifest. The public smoke test installs from the canonical
URL and checks startup, localhost authentication, SQLite, PTY, repeated start,
update without stopping tasks, reinstall, stop/restart and browser opening.
