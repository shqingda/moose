# Moose Web distribution

Public installer: `https://moose.shqingda.workers.dev/install.sh`.

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
Re-run the installer to update, then stop and start Moose when running tasks may
be interrupted. Old release directories are retained, and workspace data is untouched.

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

For isolated tests, use `MOOSE_INSTALL_DIR`, `MOOSE_BIN_DIR`,
`MOOSE_WEB_DATA_DIR`, `MOOSE_NO_MODIFY_PATH=1`, and `MOOSE_NO_OPEN=1`.
`MOOSE_DOWNLOAD_BASE` overrides the distribution origin. The smoke test installs in
a temporary directory with system-only PATH, exercises authenticated requests and a
real terminal command, and cleans up its service and installation.
