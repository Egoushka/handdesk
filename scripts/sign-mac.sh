#!/usr/bin/env bash
# Signs the release binary with a persistent self-signed identity so macOS keeps the Screen Recording and
# Accessibility grants across rebuilds (an ad hoc signature changes with every build). Needs no sudo; the identity
# lives in the login keychain and never leaves the Mac.
#   scripts/sign-mac.sh [path/to/handdesk]
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
bin="${1:-$root/agent/.build/release/handdesk}"
name="handdesk local"
ident="online.hrabovskyi.handdesk"
# A dedicated keychain with an empty password: the login keychain is locked in a non-GUI (ssh) session and refuses imports there.
keychain="$HOME/Library/Keychains/handdesk-signing.keychain-db"
[ -f "$bin" ] || { echo "sign-mac: no binary at $bin (build first)" >&2; exit 1; }

unlock() { security unlock-keychain -p "" "$keychain" >/dev/null 2>&1; }

have_identity() { security find-identity -p codesigning "$keychain" 2>/dev/null | grep -q "\"$name\""; }

create_identity() {
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cat > "$tmp/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$tmp/openssl.cnf" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null || return 1
  local pass; pass="$(openssl rand -hex 12)"
  openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/id.p12" -passout "pass:$pass" 2>/dev/null || return 1
  [ -f "$keychain" ] || security create-keychain -p "" "$keychain" >/dev/null 2>&1 || return 1
  security set-keychain-settings "$keychain" >/dev/null 2>&1 || true # no auto-lock
  unlock
  security import "$tmp/id.p12" -k "$keychain" -P "$pass" -T /usr/bin/codesign >/dev/null 2>&1 || return 1
  # lets codesign use the key without a dialog (empty keychain password, so no prompt)
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$keychain" >/dev/null 2>&1 || true
  return 0
}

signed=""
unlock
if ! have_identity; then
  create_identity || echo "sign-mac: could not create the '$name' identity" >&2
fi
if have_identity; then
  if codesign --force --keychain "$keychain" --sign "$name" --identifier "$ident" "$bin" 2>/tmp/sign-mac.err; then
    signed="self-signed '$name'"
  else
    echo "sign-mac: signing with '$name' failed: $(tr '\n' ' ' < /tmp/sign-mac.err)" >&2
  fi
fi
if [ -z "$signed" ]; then
  codesign --force --sign - --identifier "$ident" "$bin" || { echo "sign-mac: ad hoc signing failed" >&2; exit 1; }
  signed="ad hoc"
  echo "WARNING: signed ad hoc: the signature changes on every build, so Screen Recording and Accessibility may need to be granted again." >&2
fi
codesign --verify --strict "$bin" && echo "signed: $signed"
codesign -d -r- "$bin" 2>&1 | grep -E '^designated' || true
