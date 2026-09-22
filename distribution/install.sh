#!/bin/sh
# Moose standalone installer. No sudo, package manager, or existing Node required.
set -eu
main() {
  base=${MOOSE_DOWNLOAD_BASE:-https://moose.shqingda.workers.dev}
  install_dir=${MOOSE_INSTALL_DIR:-"$HOME/.local/share/moose"}
  bin_dir=${MOOSE_BIN_DIR:-"$HOME/.local/bin"}
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) platform=darwin-arm64 ;;
    *) printf '%s\n' 'This release supports macOS Apple Silicon only.' >&2; exit 1 ;;
  esac
  for tool in curl tar shasum; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
  done
  if [ -e "$bin_dir/moose" ] || [ -L "$bin_dir/moose" ]; then
    [ "$(readlink "$bin_dir/moose" 2>/dev/null || true)" = "$install_dir/current/bin/moose" ] || {
      echo "Refusing to replace an unrelated command: $bin_dir/moose" >&2; exit 1;
    }
  fi
  umask 077
  mkdir -p "$install_dir/releases" "$bin_dir"
  staging=$(mktemp -d "$install_dir/.install.XXXXXX")
  trap 'rm -rf "$staging"' EXIT
  trap 'exit 1' HUP INT TERM
  curl -fsSL --retry 3 "$base/latest-$platform.txt" -o "$staging/manifest"
  read -r release checksum parts < "$staging/manifest"
  case "$release" in ''|*[!a-zA-Z0-9.-]*) echo 'Invalid release identifier' >&2; exit 1 ;; esac
  case "$checksum" in ''|*[!a-f0-9]*) echo 'Invalid checksum' >&2; exit 1 ;; esac
  [ "${#checksum}" -eq 64 ] || exit 1
  case "$parts" in ''|*[!0-9]*) echo 'Invalid part count' >&2; exit 1 ;; esac
  [ "$parts" -ge 1 ] && [ "$parts" -le 100 ] || exit 1
  printf 'Installing Moose %s…\n' "$release"
  part=0
  while [ "$part" -lt "$parts" ]; do
    curl -fsSL --retry 3 "$base/releases/$release/$platform/part-$part" -o "$staging/part"
    cat "$staging/part" >> "$staging/package.tar.gz"
    part=$((part + 1))
  done
  actual=$(shasum -a 256 "$staging/package.tar.gz")
  [ "${actual%% *}" = "$checksum" ] || { echo 'Download checksum mismatch; installation unchanged.' >&2; exit 1; }
  mkdir "$staging/package"
  tar -xzf "$staging/package.tar.gz" -C "$staging/package"
  "$staging/package/bin/moose" --version
  destination="$install_dir/releases/$release"
  if [ ! -d "$destination" ]; then mv "$staging/package" "$destination"; fi
  ln -s "$destination" "$staging/current"
  "$destination/runtime/bin/node" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$staging/current" "$install_dir/current"
  ln -sfn "$install_dir/current/bin/moose" "$bin_dir/moose"
  if [ "${MOOSE_NO_MODIFY_PATH:-0}" != 1 ] && [ "$bin_dir" = "$HOME/.local/bin" ]; then
    # New login and interactive shells pick up the command; never edit a custom shell config.
    for profile in "$HOME/.profile" "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
      if ! grep -Fq '# Moose CLI' "$profile" 2>/dev/null; then
        printf '\n# Moose CLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$profile"
      fi
    done
  fi
  printf '\nMoose installed. Open a new terminal and run: moose\n'
  printf 'Or run now: %s/moose\n' "$bin_dir"
  printf 'Update: run this installer again, then moose stop && moose\n'
}
main "$@"
