# Threat model

What we are working on: a Swift agent on the Mac that serves a page and one WebSocket, captures the displays and posts mouse and keyboard events (CGEvent); a WebXR page in the Quest Browser that talks to it.

What can go wrong, and what stops it:

| Threat | Control |
|---|---|
| Another host or another browser tab injects input | `/ws` needs a 128-bit random pairing token (constant-time compare, file mode 0600); a request whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or the `--host` name is refused (DNS rebinding); `Origin` must equal `Host` |
| The agent is reachable from the LAN | It binds IPv4 loopback by default; the Quest reaches it through `adb reverse`. `--lan` needs `--tls-p12` and is opt-in |
| Oversized or malformed frames, slow connections | WebSocket frames capped at 1 MiB, no fragmentation, HTTP headers capped at 16 KiB, at most 8 sessions, 10 s to upgrade |
| Path traversal on the static server | Paths are percent-decoded, then refused if they contain `..`, and resolved under the page directory only |
| A flood of events (huge scroll, magnify, text) | Numbers are range-checked and clamped, text is capped and chunked |
| A stuck key or button after a dropped session | The session releases the held mouse button and modifiers on close |
| A tampered release | Actions are pinned to commit hashes; the build job has a read-only token and no cache; only the publish job can write |
| Screen content leaves the Mac | The stream goes only to the authenticated client; there is no cloud and no telemetry |

Accepted for v0.1 (open): the token sits in `localStorage` of the Quest Browser; the pairing URL is printed to the terminal; release files carry a SHA-256 file but no build attestation; the agent is not code-signed or notarized.

Last reviewed 2026-11-26 (gate review of the whole repo, findings fixed).
