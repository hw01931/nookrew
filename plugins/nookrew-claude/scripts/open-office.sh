#!/bin/sh
set -eu
[ "$#" -eq 1 ] || { echo 'PROJECT_ARGUMENT_REQUIRED' >&2; exit 1; }
case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo UNSUPPORTED_OS >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo UNSUPPORTED_ARCH >&2; exit 1 ;; esac
target="$platform-$arch"
case "$target" in
  darwin-arm64) expected='99eef3b9864ec85e65fda8ede093e5c60adab38644d540a889cb1eb2dd1b7a78'; file='Nookrew-0.2.0-beta.2-darwin-arm64.tar.gz' ;;
  darwin-x64) expected='8aaf05d517fab22b4c09f88d336ec35f0442f773d336e7f7a08dd3550985ddfa'; file='Nookrew-0.2.0-beta.2-darwin-x64.tar.gz' ;;
  linux-arm64) expected='d58c66bddd883a64aa10782aacb273d7dd831e1c07e6b581924c36ecb75f437a'; file='Nookrew-0.2.0-beta.2-linux-arm64.tar.gz' ;;
  linux-x64) expected='6041ab68a2a6e4f3f1f729e2677a4028e83d87fd45cbd9f58a539bb0335e6988'; file='Nookrew-0.2.0-beta.2-linux-x64.tar.gz' ;;
  *) exit 1 ;;
esac
cache="$HOME/.cache/nookrew/0.2.0-beta.2/$target"
if [ ! -f "$cache/nookrew/runtime/bin/node" ]; then
 mkdir -p "$cache"
 archive="$cache/$file"
 curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/hw01931/nookrew/releases/download/v0.2.0-beta.2/'"$file" -o "$archive"
 if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | cut -d ' ' -f 1); else actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1); fi
 [ "$actual" = "$expected" ] || { echo ARCHIVE_CHECKSUM_MISMATCH >&2; exit 1; }
 tar -xzf "$archive" -C "$cache"
fi
exec "$cache/nookrew/runtime/bin/node" "$cache/nookrew/scripts/open-office.cjs" "$1"
