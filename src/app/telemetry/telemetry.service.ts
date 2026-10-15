import { SimulationPace } from './simulationPace';
import { LapChange, emptyPlan, setupError } from './sessionSetup';
import { EditorSimulationControl } from './editorSimulationControl';
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { LiveSample, ParameterChange, SessionHistory } from './sessionHistory';
export { LiveSample } from './sessionHistory';

export interface LiveChannel { id: string; unit: string; sourceHz: number; available: boolean }
export interface LiveParameter { id: string; label: string; unit: string; value: number; min: number; max: number; available: boolean }
export interface CommandState { pending: boolean; message: string; error: boolean }

@Injectable()
export class TelemetryService implements OnDestroy {
  readonly editor = new EditorSimulationControl(token => this.connect(token), message => this.error = message);
  state = 'Disconnected';
  lapPlan = emptyPlan();
  baselineParameters: LiveParameter[] = [];
  private completedTotal?: number;
  private completedEvents = 0;
  error = '';
  session = '';
  channels: LiveChannel[] = [];
  parameters: LiveParameter[] = [];
  latest?: LiveSample;
  private readonly pace = new SimulationPace();
  get simulationRatio() { return this.stale ? undefined : this.pace.ratio; }
  history = new SessionHistory();
  recordingPath = '';
  recordingError = '';
  loadingSample = false;
  sampleSession = false;
  stopping = false;
  stopMessage = '';
  private supportsStop = false;
  private stopRequestId = '';
  private stopTimer?: ReturnType<typeof setTimeout>;
  get canStopSimulation() { return this.state === 'Connected' && this.supportsStop && !this.stopping; }
  head = 0;
  private eventHead = 0;
  private historyPending = false;
  private historyRequestedAt = 0;
  private historyTimer?: ReturnType<typeof setInterval>;
  get missingSamples() { return Math.max(0, this.head - this.history.length); }
  commands: Record<string, CommandState> = {};
  receivedHz = 0;
  private socket?: WebSocket;
  private connectionVersion = 0;
  private token = '';
  private reconnect = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastReceived = 0;
  private lastTelemetry = 0;
  private rateStart = 0;
  private rateCount = 0;
  private pending = new Map<string, { parameter: string; timer: ReturnType<typeof setTimeout> }>();

  constructor(private zone: NgZone) {}
  get stale() { return !this.latest || !this.lastTelemetry || performance.now() - this.lastTelemetry > 2000; }
  get ready() { return this.state === 'Connected' && !this.stale && !this.stopping; }

  startSimulation(token = '') {
    if (!this.editor.available || this.editor.starting) return;
    const error = this.lapPlan.map(lap => setupError(lap, this.baselineParameters.length ? this.baselineParameters : this.parameters)).find(Boolean);
    if (error) { this.error = error; return; }
    this.disconnect(); this.error = ''; this.editor.start(token, this.lapPlan);
  }
  connect(token: string) {
    this.disconnect(); this.stopMessage = '';
    if (!/^[a-f0-9]{32}$/i.test(token.trim())) { this.error = 'Paste the 32-character session token from Unity.'; return; }
    this.token = token.trim();
    this.reconnect = true;
    this.open();
  }
  private open() {
    this.error = '';
    this.state = 'Connecting';
    this.zone.runOutsideAngular(() => {
      const socket = new WebSocket('ws://127.0.0.1:42480/live');
      this.socket = socket;
      socket.onopen = () => {
        if (socket !== this.socket) return;
        this.state = 'Pairing';
        this.lastReceived = performance.now();
        socket.send(JSON.stringify({ type: 'hello', protocol: 2, token: this.token }));
        this.heartbeat = setInterval(() => {
          if (socket !== this.socket) return;
          if (performance.now() - this.lastReceived > (this.stopping ? 10000 : 5000)) { socket.close(); return; }
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, 1000);
      };
      socket.onmessage = event => {
        if (socket !== this.socket) return;
        try { this.receive(JSON.parse(event.data)); }
        catch { this.error = 'Unity sent an invalid message.'; this.reconnect = false; socket.close(); }
      };
      socket.onerror = () => {
        if (socket !== this.socket) return;
        this.error = 'Cannot reach Unity. Check Play Mode, the bridge, and Chrome’s local-network permission.';
      };
      socket.onclose = () => {
        if (socket !== this.socket) return;
        clearInterval(this.heartbeat); clearInterval(this.historyTimer); this.historyPending = false;
        if (this.stopping) this.error = 'Unity disconnected before confirming the stop. Check Unity before reconnecting.';
        this.clearStop();
        this.state = this.reconnect ? 'Reconnecting' : 'Disconnected';
        this.failPending('Connection lost. Application is unconfirmed; reconnect to read current values.');
        if (this.reconnect) this.retryTimer = setTimeout(() => this.open(), 2000);
      };
    });
  }
  private receive(message: Record<string, unknown>) {
    this.lastReceived = performance.now();
    switch (message['type']) {
      case 'welcome': {
        if (message['protocol'] !== 2 || !Array.isArray(message['channels']) || message['channels'].length < 1 || message['channels'].length > 64 || !Array.isArray(message['parameters'])) throw new Error();
        const channels = message['channels'] as LiveChannel[];
        const parameters = message['parameters'] as LiveParameter[];
        if (!channels.every(c => typeof c.id === 'string' && typeof c.unit === 'string' && Number.isFinite(c.sourceHz) && typeof c.available === 'boolean') ||
            !parameters.every(p => typeof p.id === 'string' && typeof p.label === 'string' && typeof p.unit === 'string' && [p.value, p.min, p.max].every(Number.isFinite) && typeof p.available === 'boolean')) throw new Error();
        this.sampleSession = false; this.supportsStop = message['canStopSimulation'] === true;
        this.channels = channels;
        this.parameters = parameters;
        if (Array.isArray(message['baselineParameters'])) this.baselineParameters = message['baselineParameters'] as LiveParameter[];
        else if (message['session'] !== this.session) this.baselineParameters = parameters.map(p => ({...p}));
        if (Array.isArray(message['lapPlan']) && message['lapPlan'].length === 2) this.lapPlan = message['lapPlan'] as LapChange[];
        const session = String(message['session']);
        if (session !== this.session || this.history.channelCount !== channels.length) { this.history = new SessionHistory(channels.length); this.head = 0; this.eventHead = 0; }
        this.session = session;
        this.recordingPath = String(message['recordingPath'] || '');
        this.recordingError = String(message['recordingError'] || '');
        this.head = Number(message['recordedSamples']) || 0;
        this.latest = undefined; this.lastTelemetry = 0; this.commands = {}; this.pace.reset();
        this.historyPending = false;
        clearInterval(this.historyTimer);
        this.historyTimer = setInterval(() => this.requestHistory(), 100);
        this.rateStart = performance.now(); this.rateCount = 0; this.receivedHz = 0;
        this.state = 'Connected';
        this.requestHistory(true);
        break;
      }
      case 'sessionComplete': {
        if (!Number.isSafeInteger(message['total']) || !Number.isSafeInteger(message['eventTotal'])) throw new Error();
        this.completedTotal = message['total'] as number; this.completedEvents = message['eventTotal'] as number;
        this.head = Math.max(this.head, this.completedTotal); this.eventHead = Math.max(this.eventHead, this.completedEvents);
        this.finishCompletedSession(); this.requestHistory(true); break;
      }
      case 'simulationStopped': {
        if (!this.stopping || message['requestId'] !== this.stopRequestId) return;
        this.recordingError = typeof message['recordingError'] === 'string' ? message['recordingError'] : '';
        const complete = this.completedTotal !== undefined;
        this.disconnect(); this.stopMessage = complete ? 'Session complete · 3 / 3 laps' : 'Unity simulation stopped.';
        break;
      }
      case 'telemetry': {
        if (this.state !== 'Connected') return;
        const sample = this.validateSample(message['sample']);
        this.lastTelemetry = performance.now();
        this.latest = sample; this.pace.update(sample);
        this.head = Math.max(this.head, sample.sequence);
        const status = message['recordingError'] as { error?: string };
        this.recordingError = status?.error || '';
        this.rateCount++;
        const elapsed = performance.now() - this.rateStart;
        if (elapsed >= 1000) { this.receivedHz = this.rateCount * 1000 / elapsed; this.rateCount = 0; this.rateStart = performance.now(); }
        break;
      }
      case 'history': {
        if (!Array.isArray(message['samples']) || message['samples'].length > 500 || !Array.isArray(message['events']) || message['events'].length > 100 || !Number.isSafeInteger(message['total']) || !Number.isSafeInteger(message['eventTotal'])) throw new Error();
        for (const row of message['samples']) this.history.append(this.validateSample(row));
        this.history.addEvents(message['events'] as ParameterChange[]);
        this.head = Math.max(this.head, message['total'] as number);
        this.eventHead = message['eventTotal'] as number;
        this.historyPending = false;
        if (this.missingSamples > 0 || this.eventHead > this.history.events.length) this.requestHistory();
        this.finishCompletedSession();
        break;
      }
      case 'result': {
        const id = String(message['requestId']);
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(id);
        if (message['ok'] === true && Number.isFinite(message['value'])) {
          const parameter = this.parameters.find(p => p.id === pending.parameter);
          if (parameter) parameter.value = message['value'] as number;
          this.commands[pending.parameter] = { pending: false, error: false, message: `Applied · effective from frame ${message['effectiveFromFrame']}` };
        } else this.commands[pending.parameter] = { pending: false, error: true, message: String(message['error'] || 'Unity rejected this change.') };
        break;
      }
      case 'error':
        this.error = String(message['error']); this.reconnect = false; this.socket?.close(); break;
      case 'pong': this.requestHistory(true); break;
      default: throw new Error();
    }
  }
  async openSample() {
    if (this.loadingSample) return;
    this.disconnect(); this.error = ''; this.state = 'Loading sample'; this.loadingSample = true;
    const operation = this.connectionVersion;
    try {
      const base = new URL('assets/unity-live-link/sample/', document.baseURI);
      const files = await Promise.all(['session.json', 'samples.bin', 'changes.jsonl'].map(async name => {
        const response = await fetch(new URL(name, base));
        if (!response.ok) throw new Error('Cannot load the sample session. Try again when the web app is reachable.');
        return new File([await response.arrayBuffer()], name);
      }));
      if (operation !== this.connectionVersion) return;
      const parsing = this.openRecording(files), parsingVersion = this.connectionVersion;
      await parsing;
      if (parsingVersion === this.connectionVersion && this.state === 'Recorded session' && !this.error) this.sampleSession = true;
    } catch (error) {
      if (operation === this.connectionVersion) { this.state = 'Disconnected'; this.error = error instanceof Error ? error.message : 'Cannot load the sample session.'; }
    } finally { this.loadingSample = false; }
  }
  async openRecording(files: FileList | File[]) {
    this.sampleSession = false;
    this.disconnect(); this.error = '';
    const operation = this.connectionVersion;
    try {
      // Directory pickers include descendants: only use files directly in the chosen folder.
      const selected = Array.from(files).filter(f => !f.webkitRelativePath || f.webkitRelativePath.split('/').length === 2);
      const metadataFile = selected.find(f => f.name === 'session.json');
      const binaryFile = selected.find(f => f.name === 'samples.bin');
      const eventFile = selected.find(f => f.name === 'changes.jsonl');
      if (!metadataFile || !binaryFile || !eventFile) throw new Error('Choose one session folder containing session.json, samples.bin and changes.jsonl.');
      const metadata = JSON.parse(await metadataFile.text());
      const binary = new DataView(await binaryFile.arrayBuffer());
      const count = binary.byteLength >= 8 ? binary.getInt32(4, true) : 0, rowBytes = 25 + count * 4;
      if (metadata.protocol !== 2 || !Array.isArray(metadata.channels) || metadata.channels.length !== count || !Array.isArray(metadata.parameters)) throw new Error('Invalid recording metadata.');
      if (binary.byteLength < 8 || String.fromCharCode(...new Uint8Array(binary.buffer, 0, 4)) !== 'ULL2' || count < 1 || count > 64 || (binary.byteLength - 8) % rowBytes !== 0) throw new Error('Invalid or incomplete recording. Stop the Unity bridge before opening its files.');
      const history = new SessionHistory(count);
      for (let offset = 8; offset < binary.byteLength; offset += rowBytes) {
        const values = Array.from({ length: count }, (_, c) => { const v = binary.getFloat32(offset + 25 + c * 4, true); return Number.isFinite(v) ? v : null; });
        history.append(this.validateSample({ sequence: binary.getInt32(offset, true), frame: binary.getInt32(offset + 4, true), time: binary.getFloat64(offset + 8, true), simulationTime: binary.getFloat64(offset + 16, true), paused: !!binary.getUint8(offset + 24), values }, count));
      }
      const changes = (await eventFile.text()).trim();
      history.addEvents(changes ? changes.split(/\r?\n/).map(line => JSON.parse(line)) : []);
      if (metadata.complete !== true || metadata.recordedSamples !== history.length || metadata.recordedEvents !== history.events.length) throw new Error('Recording is incomplete or the selected files do not match. Stop the Unity bridge before opening its files.');
      if (operation !== this.connectionVersion) return;
      this.history = history; this.head = history.length; this.eventHead = history.events.length;
      this.channels = metadata.channels; this.parameters = metadata.parameters;
      this.baselineParameters = (metadata.baselineParameters || this.parameters).map((p: LiveParameter) => ({...p}));
      if (Array.isArray(metadata.lapPlan) && metadata.lapPlan.length === 2) this.lapPlan = metadata.lapPlan;
      for (const event of history.events) { const p = this.parameters.find(p => p.id === event.result.parameter); if (p) p.value = event.result.value; }
      this.session = String(metadata.session); this.latest = undefined; this.recordingPath = String(metadata.recordingPath || 'Opened local recording');
      this.commands = {}; this.recordingError = ''; this.state = 'Recorded session';
    } catch (error) { if (operation === this.connectionVersion) this.error = error instanceof Error ? error.message : 'Cannot open recording.'; }
  }
  private validateSample(value: unknown, channelCount = this.channels.length): LiveSample {
    const s = value as LiveSample;
    if (!s || !Number.isSafeInteger(s.sequence) || s.sequence < 1 || !Number.isSafeInteger(s.frame) || !Number.isFinite(s.time) || !Number.isFinite(s.simulationTime) || typeof s.paused !== 'boolean' || !Array.isArray(s.values) || s.values.length !== channelCount || !s.values.every(v => v === null || typeof v === 'number' && Number.isFinite(v))) throw new Error();
    return s;
  }
  private requestHistory(force = false) {
    if (this.state !== 'Connected' || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.historyPending) {
      if (performance.now() - this.historyRequestedAt > 5000) this.socket.close();
      return;
    }
    if (!force && !this.missingSamples && this.eventHead <= this.history.events.length) return;
    this.historyPending = true; this.historyRequestedAt = performance.now();
    this.socket.send(JSON.stringify({ type: 'history', after: this.history.length, eventAfter: this.history.events.length, limit: 500 }));
  }
  setParameter(parameter: LiveParameter, value: number) {
    if (!this.ready || !parameter.available || this.commands[parameter.id]?.pending) return;
    if (!Number.isFinite(value) || value < parameter.min || value > parameter.max) {
      this.commands[parameter.id] = { pending: false, error: true, message: `Enter a value from ${parameter.min} to ${parameter.max} ${parameter.unit}.` }; return;
    }
    const requestId = crypto.randomUUID();
    this.commands[parameter.id] = { pending: true, error: false, message: 'Waiting for Unity' };
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      this.commands[parameter.id] = { pending: false, error: true, message: 'Application unconfirmed. Reconnect to read the current value before retrying.' };
      this.reconnect = false; this.socket?.close();
    }, 3000);
    this.pending.set(requestId, { parameter: parameter.id, timer });
    this.socket?.send(JSON.stringify({ type: 'setParameter', requestId, parameter: parameter.id, value }));
  }
  private finishCompletedSession() {
    if (this.completedTotal !== undefined && this.history.length >= this.completedTotal && this.history.events.length >= this.completedEvents && !this.stopping) this.stopSimulation();
  }
  stopSimulation() {
    if (!this.canStopSimulation || this.socket?.readyState !== WebSocket.OPEN) return;
    this.stopping = true; this.stopMessage = ''; this.error = ''; this.reconnect = false;
    this.stopRequestId = crypto.randomUUID();
    clearTimeout(this.retryTimer);
    this.stopTimer = setTimeout(() => {
      this.error = 'Unity has not confirmed the stop. Check Unity before reconnecting.';
      this.disconnect();
    }, 10000);
    try { this.socket.send(JSON.stringify({ type: 'stopSimulation', requestId: this.stopRequestId })); }
    catch { this.error = 'Could not send the stop command. Check Unity before reconnecting.'; this.disconnect(); }
  }
  private clearStop() { clearTimeout(this.stopTimer); this.stopRequestId = ''; this.stopping = false; }
  private failPending(message: string) {
    this.pending.forEach(p => { clearTimeout(p.timer); this.commands[p.parameter] = { pending: false, error: true, message }; });
    this.pending.clear();
  }
  disconnect() {
    this.editor.cancel();
    this.completedTotal = undefined; this.completedEvents = 0;
    this.clearStop(); this.supportsStop = false;
    this.connectionVersion++;
    this.reconnect = false;
    clearTimeout(this.retryTimer); clearInterval(this.heartbeat); clearInterval(this.historyTimer); this.historyPending = false; clearInterval(this.historyTimer); this.historyPending = false;
    this.failPending('Disconnected. Application is unconfirmed.');
    const previous = this.socket; this.socket = undefined; previous?.close();
    this.token = ''; this.state = 'Disconnected'; this.receivedHz = 0;
  }
  ngOnDestroy() { this.disconnect(); this.editor.dispose(); }
}
