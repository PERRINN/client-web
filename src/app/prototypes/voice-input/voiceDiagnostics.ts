import type { VoiceCaptureService } from './voiceCapture.service';
import type { VoiceInputService } from './voiceInput.service';
import type { VoiceQueueService } from './voiceQueue.service';

export interface VoiceDiagnosticRow { label: string; value: string; ok: boolean }
export interface VoiceDeviceState { online: boolean; visible: boolean; secure: boolean; gesture: string; gestureSince: number }

// Keep only machine codes, never exception messages that could contain data.
export function voiceDiagnosticCode(error: unknown): string {
  const code = (error as { code?: unknown; name?: string })?.code;
  if (typeof code === 'number' && Number.isInteger(code) && code < 0) return 'NG' + Math.abs(code).toString().padStart(4, '0');
  if (typeof code === 'string' && /^[a-zA-Z0-9/-]{1,64}$/.test(code)) return code.replace('functions/', '');
  const name = (error as { name?: string })?.name;
  return name && /^[a-zA-Z]{1,40}$/.test(name) ? name : 'Unknown error';
}

export function voiceDiagnosticRows(voice: Pick<VoiceInputService, 'phase' | 'phaseSince' | 'ready' | 'uid' | 'canToggle' | 'captureFailure'>,
  queue: VoiceQueueService['diagnostics'], capture: VoiceCaptureService['diagnostics'], device: VoiceDeviceState, now = Date.now()): VoiceDiagnosticRow[] {
  const seconds = (since: number) => Math.max(0, Math.floor((now - since) / 1000));
  const phaseAge = seconds(voice.phaseSince), preparing = voice.phase === 'sending';
  const active = voice.phase === 'recording', requesting = voice.phase === 'requesting';
  const expectedWait = preparing && phaseAge < 10;
  const lock = !voice.ready ? 'Account loading' : !voice.uid ? 'Signed out' : queue.unsaved ? 'Audio not saved'
    : queue.storageError ? 'Local DB error' : !queue.ready ? 'Local DB loading' : queue.total >= 10 ? 'Queue full'
    : preparing ? (expectedWait ? 'Finishing audio' : 'Preparation stalled') : !voice.canToggle ? 'Control unavailable' : 'None';
  const lockOk = lock === 'None' || expectedWait && lock === 'Finishing audio';
  const captureOk = requesting ? phaseAge < 30 : active ? phaseAge <= 32 : !preparing || expectedWait;
  const audioOk = !active || capture.context === 'running';
  const micOk = !active || capture.liveTracks > 0 && !capture.muted;
  const batchAge = seconds(capture.lastSampleAt || capture.connectedAt || now);
  const workletOk = !active || capture.worklet && batchAge <= 3;
  const uploadOverdue = queue.running && now >= queue.deadline;
  const backoff = queue.nextAt > now ? Math.ceil((queue.nextAt - now) / 1000) : 0;
  const cloudOk = !queue.resultFailures && !queue.resultCode && (!queue.received || queue.listeners === queue.received && queue.confirmedResults === queue.received);
  const serverOverdue = queue.received > 0 && queue.resultStatus === 'processing' && queue.resultDeadline > 0 && now > queue.resultDeadline + 5000;
  const lastFault = queue.storageCode || voice.captureFailure || queue.uploadCode || queue.resultCode || (serverOverdue ? 'Worker lease expired' : queue.resultStatus === 'failed' ? 'Transcription failed' : '');
  return [
    { label: 'Button', value: voice.canToggle ? (active ? 'Enabled · Stop' : requesting ? 'Enabled · Cancel' : 'Enabled · Start') : 'Disabled', ok: voice.canToggle || expectedWait && lockOk },
    { label: 'Lock', value: lock, ok: lockOk },
    { label: 'Last fault', value: lastFault || 'None', ok: !lastFault },
    { label: 'Local DB', value: queue.storageError ? queue.storageCode || 'Unavailable' : queue.storageWork ? `Working · ${seconds(queue.storageSince)}s` : queue.ready ? 'Ready' : 'Loading', ok: queue.ready && !queue.storageError && (!queue.storageWork || seconds(queue.storageSince) < 5) },
    { label: 'Cloud DB', value: queue.resultCode ? queue.resultCode : queue.resultFailures ? 'Listener failed' : queue.received ? `${queue.listeners}/${queue.received} listening · ${queue.confirmedResults} server${queue.resultStatus ? ' · ' + queue.resultStatus : ''}${queue.resultCached ? ' · Cached' : ''}` : 'No pending results', ok: cloudOk },
    { label: 'Server', value: queue.received ? (queue.resultStatus || 'Not observed') + (serverOverdue ? ' · Lease expired' : queue.resultCached ? ' · Cached' : queue.confirmedResults < queue.received ? ' · Last observed' : '') : 'Idle', ok: !queue.received || ['receiving', 'queued', 'processing', 'completed'].includes(queue.resultStatus) && !serverOverdue && !queue.resultCached && queue.confirmedResults === queue.received },
    { label: 'Upload', value: queue.running ? `${queue.stage} · ${seconds(queue.startedAt)}s${uploadOverdue ? ' · Overdue' : ''}` : backoff ? `Retry in ${backoff}s` : queue.unsent && (!device.online || !device.visible) ? 'Paused' : 'Idle', ok: !uploadOverdue && !queue.uploadCode && (!queue.unsent || device.online && device.visible) },
    { label: 'Queue', value: `${queue.total}/10 · ${queue.unsent} unsent`, ok: !queue.unsaved && queue.total < 10 },
    { label: 'Device', value: !device.secure ? 'HTTPS required' : capture.supported ? 'Supported' : 'Audio unsupported', ok: device.secure && capture.supported },
    { label: 'Account', value: voice.ready ? voice.uid ? 'Signed in' : 'Signed out' : 'Loading', ok: voice.ready && !!voice.uid },
    { label: 'Network', value: device.online ? 'Online reported' : 'Offline', ok: device.online },
    { label: 'Page', value: device.visible ? 'Visible' : 'Hidden', ok: device.visible },
    { label: 'Capture', value: `${voice.phase} · ${phaseAge}s`, ok: captureOk },
    { label: 'Microphone', value: capture.permissionPending ? 'Permission pending' : capture.liveTracks ? capture.muted ? 'Muted' : 'Live' : 'Released', ok: micOk && (!requesting || phaseAge < 30) },
    { label: 'Audio context', value: capture.context, ok: audioOk },
    { label: 'Worklet', value: capture.worklet ? `${Math.floor(capture.durationMs)}ms · batch ${batchAge}s ago` : 'Idle', ok: workletOk },
    { label: 'Gesture', value: device.gesture + (device.gestureSince ? ` · ${seconds(device.gestureSince)}s` : ''), ok: !device.gestureSince || active || requesting || seconds(device.gestureSince) < 5 },
    { label: 'Recovery', value: `DB ${queue.storageRetries}/3 · Results ${queue.resultRetries}/3`, ok: !queue.storageError && !queue.resultFailures }
  ];
}
