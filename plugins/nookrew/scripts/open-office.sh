#!/bin/sh
set -eu
[ "$#" -eq 1 ] || { echo 'PROJECT_ARGUMENT_REQUIRED' >&2; exit 1; }
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo UNSUPPORTED_OS >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo UNSUPPORTED_ARCH >&2; exit 1 ;; esac
target="$platform-$arch"
case "$target" in
  darwin-arm64) expected='5d264b1313ffdf9226ee17d47b19c14a873e1ab914ec1e75dd242d49f0f8b193'; file='Nookrew-0.2.0-beta.3-darwin-arm64.tar.gz' ;;
  darwin-x64) expected='4b7469c37c8c321fbf3d03cc6a1e5883d3c2592f099066aca091db52a5b9be2c'; file='Nookrew-0.2.0-beta.3-darwin-x64.tar.gz' ;;
  linux-arm64) expected='f39725100f93745e869f715f3e253e5b77f38532345d5f68ad1d8c07bcc17163'; file='Nookrew-0.2.0-beta.3-linux-arm64.tar.gz' ;;
  linux-x64) expected='b6114eee6e1332bcfddec475ab25af8b63416a4333486ac3d829749c28e44df6'; file='Nookrew-0.2.0-beta.3-linux-x64.tar.gz' ;;
  *) exit 1 ;;
esac
cache="$HOME/.cache/nookrew/0.2.0-beta.3/$target"
if [ ! -f "$cache/nookrew/runtime/bin/node" ]; then
 mkdir -p "$cache"
 archive="$cache/$file"
 curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/hw01931/nookrew/releases/download/v0.2.0-beta.3/'"$file" -o "$archive"
 if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | cut -d ' ' -f 1); else actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1); fi
 [ "$actual" = "$expected" ] || { echo ARCHIVE_CHECKSUM_MISMATCH >&2; exit 1; }
 tar -xzf "$archive" -C "$cache"
fi
exec "$cache/nookrew/runtime/bin/node" "$cache/nookrew/scripts/open-office.cjs" "$1"
