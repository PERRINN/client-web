import { LapChange } from './sessionSetup';
// Local Editor pairing is separate from each transient runtime telemetry session.
export class EditorSimulationControl {
  available = false;
  checking = true;
  starting = false;
  status = '';
  private presence?: WebSocket;
  private presenceTimer?: ReturnType<typeof setInterval>;
  private presenceTimeout?: ReturnType<typeof setTimeout>;
  private savedToken = '';
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private timeout?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private requestId = '';
  private laps: LapChange[] = [];
  private authenticatedOnce = false;
  private readonly storageKey = 'perrinn.telemetry.editorToken';
  constructor(private connected: (token: string) => void, private failed: (message: string) => void) {
    try { this.savedToken = localStorage.getItem(this.storageKey) || ''; } catch { /* Storage may be unavailable. */ }
  }
  watch() {
    if (this.presenceTimer) return;
    this.checkPresence();
    this.presenceTimer = setInterval(() => this.checkPresence(), 3000);
  }
  dispose() { this.cancel(); clearInterval(this.presenceTimer); this.presenceTimer = undefined; this.closePresence(); }
  private closePresence() {
    clearTimeout(this.presenceTimeout);
    const previous = this.presence; this.presence = undefined; previous?.close();
  }
  private checkPresence() {
    if (this.starting || this.presence) return;
    let confirmed = false;
    try {
      const socket = new WebSocket('ws://127.0.0.1:42482/live'); this.presence = socket;
      const finish = () => {
        if (socket !== this.presence) return;
        this.available = confirmed; this.checking = false; this.closePresence();
      };
      this.presenceTimeout = setTimeout(finish, 2000);
      socket.onopen = () => { if (socket === this.presence) socket.send(JSON.stringify({type:'editorProbe'})); };
      socket.onmessage = event => {
        if (socket !== this.presence) return;
        try { confirmed = JSON.parse(event.data).type === 'editorAvailable'; } catch { /* Unknown services are unavailable. */ }
        finish();
      };
      socket.onerror = finish; socket.onclose = finish;
    } catch { this.available = false; this.checking = false; this.closePresence(); }
  }
  get paired() { return /^[a-f0-9]{32}$/i.test(this.savedToken); }
  get needsPairing() { return this.available && !this.paired; }
  private clearPairing() {
    this.savedToken = '';
    try { localStorage.removeItem(this.storageKey); } catch { /* The current tab still forgets the token. */ }
  }
  start(value = '', laps: LapChange[] = []) {
    this.laps = laps.map(lap => ({...lap}));
    if (this.starting) return;
    this.authenticatedOnce = false;
    const token = value.trim() || this.savedToken;
    if (!/^[a-f0-9]{32}$/i.test(token)) { this.fail('Pair once: in Unity choose PERRINN → Copy 424 Telemetry Editor pairing token, then paste it here.'); return; }
    this.closePresence();
    this.starting = true; this.status = 'Connecting to Unity Editor…'; this.authenticatedOnce = false;
    this.requestId = crypto.randomUUID();
    this.timeout = setTimeout(() => this.fail('Unity did not confirm Autopilot startup within 90 seconds. Check the Editor before retrying.'), 90000);
    this.open(token);
  }
  private open(token: string) {
    if (!this.starting) return;
    const socket = new WebSocket('ws://127.0.0.1:42482/live'); this.socket = socket;
    let paired = false;
    socket.onopen = () => { if (socket === this.socket) socket.send(JSON.stringify({type:'editorHello',token})); };
    socket.onmessage = event => {
      if (socket !== this.socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'editorReady') {
          paired = true; this.authenticatedOnce = true; this.savedToken = token;
          try { localStorage.setItem(this.storageKey, token); } catch { /* Pairing remains available in this tab. */ }
          this.status = 'Starting Unity and Autopilot…';
          socket.send(JSON.stringify({type:'startSimulation',requestId:this.requestId,laps:this.laps}));
          clearInterval(this.poll);
          this.poll = setInterval(() => { if (socket === this.socket && paired && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'editorStatus'})); }, 500);
          return;
        }
        if (message.type !== 'editorStatus') throw new Error('Unexpected Editor response.');
        if (message.phase === 'error' && (!message.requestId || message.requestId === this.requestId)) { this.fail(message.error || 'Unity could not start Autopilot.'); return; }
        if (message.requestId !== this.requestId) return;
        if (message.phase === 'running') {
          if (message.autopilot !== true || !/^[a-f0-9]{32}$/i.test(message.token || '')) throw new Error('Unity did not confirm Autopilot and telemetry readiness.');
          const runtimeToken = message.token; this.cancel(); this.connected(runtimeToken);
        } else if (message.phase === 'idle') this.fail('The simulation stopped before telemetry connected.');
      } catch (error) { this.fail(error instanceof Error ? error.message : 'Invalid Unity Editor response.'); }
    };
    socket.onerror = () => { /* onclose decides whether this is a domain reload or an unavailable Editor. */ };
    socket.onclose = () => {
      if (socket !== this.socket || !this.starting) return;
      clearInterval(this.poll);
      if (!this.authenticatedOnce) { this.fail('Cannot reach Unity Editor. Keep this project open and check local-network access.'); return; }
      this.status = 'Waiting for Unity to finish entering Play Mode…';
      this.retry = setTimeout(() => this.open(token), 500);
    };
  }
  private fail(message: string) { if (!this.authenticatedOnce) this.clearPairing(); this.cancel(); this.failed(message); }
  cancel() {
    clearTimeout(this.retry); clearTimeout(this.timeout); clearInterval(this.poll);
    this.starting = false; this.status = '';
    const previous = this.socket; this.socket = undefined; previous?.close();
  }
}
