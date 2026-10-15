#!/bin/sh
set -eu
[ "$#" -eq 1 ] || { echo 'PROJECT_ARGUMENT_REQUIRED' >&2; exit 1; }
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo UNSUPPORTED_OS >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo UNSUPPORTED_ARCH >&2; exit 1 ;; esac
target="$platform-$arch"
case "$target" in
  darwin-arm64) expected='954641880893d54d43f2a603e0a238d826c1658364ae4414e538aca5de71a910'; file='Nookrew-0.2.0-beta.1-darwin-arm64.tar.gz' ;;
  darwin-x64) expected='f5a9d27205607852b14ce8ad2087b50d34aee322db8d28449d03cc1e02255e80'; file='Nookrew-0.2.0-beta.1-darwin-x64.tar.gz' ;;
  linux-arm64) expected='335696d687aa0ba91b9ab9e8e4f3766429295abb530187fac674bd5c44fec214'; file='Nookrew-0.2.0-beta.1-linux-arm64.tar.gz' ;;
  linux-x64) expected='f78cf7626a7a9b5a98963d87c06824770bbd5691dea4eba8330f4b77eeb55752'; file='Nookrew-0.2.0-beta.1-linux-x64.tar.gz' ;;
  *) exit 1 ;;
esac
cache="$HOME/.cache/nookrew/0.2.0-beta.1/$target"
if [ ! -f "$cache/nookrew/runtime/bin/node" ]; then
 mkdir -p "$cache"
 archive="$cache/$file"
 curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/hw01931/nookrew/releases/download/v0.2.0-beta.1/'"$file" -o "$archive"
 if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | cut -d ' ' -f 1); else actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1); fi
 [ "$actual" = "$expected" ] || { echo ARCHIVE_CHECKSUM_MISMATCH >&2; exit 1; }
 tar -xzf "$archive" -C "$cache"
fi
exec "$cache/nookrew/runtime/bin/node" "$cache/nookrew/scripts/open-office.cjs" "$1"
