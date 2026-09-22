# Release requirements

- Every Moose release publishes **both** macOS desktop and standalone Web installers.
- `package.json` is the single source of the version. Desktop DMG, Web package,
  release notes, Git tag and GitHub Release must use that same version.
- Follow `docs/development.md` and use `pnpm release:prepare` then
  `pnpm release:publish`; do not declare a release complete after publishing only one host.
- Validate the desktop package and a clean Web installation, then verify the public
  Web installer after deployment. Keep existing workspace data and active user tasks intact.
- Public Web distribution: https://moose.shqingda.workers.dev/install.sh.
