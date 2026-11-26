import { codecFromAnnexB, encode, parseServerText, parseVideoFrame, type ClientMessage, type DisplayInfo } from "../protocol";

export interface ConnectionEvents {
  onStatus(text: string): void;
  onHello(displays: DisplayInfo[]): void;
  /** called with a decoded frame for a display index; the callee must not keep the frame */
  onFrame(display: number, frame: VideoFrame): void;
}

export function pairingToken(): string | undefined {
  const url = new URL(location.href);
  const t = url.searchParams.get("t");
  if (t) {
    try { localStorage.setItem("handdesk.token", t); } catch { /* private mode */ }
    url.searchParams.delete("t");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    return t;
  }
  try { return localStorage.getItem("handdesk.token") ?? undefined; } catch { return undefined; }
}

/** WebSocket to the Mac agent: JSON input out, H.264 in (decoded with WebCodecs). Reconnects on its own. */
export class Connection {
  private ws: WebSocket | undefined;
  private decoders = new Map<number, { dec: VideoDecoder; codec: string; gotKey: boolean }>();
  private wanted: number[] = [0];
  private closed = false;
  private delay = 500;
  ready = false;

  constructor(private readonly ev: ConnectionEvents) {}

  connect(): void {
    const token = pairingToken();
    if (!token) { this.ev.onStatus("No pairing token: open the URL that `handdesk start` printed (it ends with ?t=...)."); return; }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.ev.onStatus("Connecting to the Mac agent");
    ws.onopen = () => { this.delay = 500; };
    ws.onmessage = (m) => {
      if (typeof m.data === "string") {
        const msg = parseServerText(m.data);
        if (msg?.type === "hello") {
          this.ready = true;
          this.ev.onStatus(`Connected: ${msg.displays.length} display(s)`);
          this.ev.onHello(msg.displays);
          this.send({ type: "subscribe", displays: this.wanted });
        } else if (msg?.type === "error") this.ev.onStatus(msg.message);
        return;
      }
      const f = parseVideoFrame(m.data as ArrayBuffer);
      if (f) this.decode(f.display, f.keyframe, f.timestampUs, f.data);
    };
    ws.onclose = () => {
      this.ready = false;
      for (const d of this.decoders.values()) { try { d.dec.close(); } catch { /* closed */ } }
      this.decoders.clear();
      if (this.closed) return;
      this.ev.onStatus("Waiting for the Mac agent");
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(5000, this.delay * 2);
    };
  }

  subscribe(displays: number[]): void {
    this.wanted = displays;
    this.send({ type: "subscribe", displays });
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  close(): void { this.closed = true; this.ws?.close(); }

  private decode(display: number, keyframe: boolean, ts: number, data: Uint8Array): void {
    if (typeof VideoDecoder === "undefined") { this.ev.onStatus("This browser has no WebCodecs"); return; }
    let d = this.decoders.get(display);
    if (!d) {
      if (!keyframe) return;
      const codec = codecFromAnnexB(data);
      if (!codec) return;
      const dec = new VideoDecoder({
        output: (frame) => { try { this.ev.onFrame(display, frame); } finally { frame.close(); } },
        error: () => {
          const old = this.decoders.get(display);
          this.decoders.delete(display);
          try { old?.dec.close(); } catch { /* already closed */ }
          this.subscribe(this.wanted);
        },
      });
      dec.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "prefer-hardware" });
      d = { dec, codec, gotKey: false };
      this.decoders.set(display, d);
    }
    if (!d.gotKey && !keyframe) return;
    d.gotKey = true;
    // a deep queue means the page is behind: drop to the next keyframe rather than lag
    if (d.dec.decodeQueueSize > 8 && !keyframe) return;
    d.dec.decode(new EncodedVideoChunk({ type: keyframe ? "key" : "delta", timestamp: ts, data }));
  }
}
