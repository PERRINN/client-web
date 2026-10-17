import { Injectable } from '@angular/core';
import { RadioFloor } from './radioState';

export interface RadioSignal {
  fromSession: string; toSession: string; offerId: string;
  type: 'offer' | 'answer'; sdp: string;
}
export interface RadioPeer { seat: string; session: string; speaker: boolean }
interface Peer {
  pc: RTCPeerConnection; session: string; offerId: string;
  sender?: RTCRtpSender; audio?: HTMLAudioElement; blocked?: boolean; playbackReady?: boolean;
  remoteSdp?: string; queue: Promise<void>;
}

/** Browser media only; Firebase coordination and authorization belong to RadioRoomService. */
@Injectable()
export class RadioAudioService {
  private context?: AudioContext;
  private output?: MediaStreamAudioDestinationNode;
  private mic?: MediaStream;
  private micSource?: MediaStreamAudioSourceNode;
  private micGate?: GainNode;
  private delay?: DelayNode;
  private peers = new Map<string, Peer>();
  private localSeat = '';
  private localSession = '';
  private floor?: RadioFloor;
  private muted = false;
  private activeToken?: string;
  private microphoneVersion = 0;
  private microphoneRequest?: Promise<void>;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  onSignal: (seat: string, signal: RadioSignal) => Promise<void> = async () => {};
  onChange: () => void = () => {};
  onError: (message: string) => void = () => {};
  onEnded: () => void = () => {};
  get ready() { return this.context?.state === 'running' && [...this.peers.values()].every(peer => peer.playbackReady && !peer.blocked); }
  get needsSound() { return this.context?.state !== 'running' || [...this.peers.values()].some(peer => peer.blocked); }
  get microphoneReady() { return !!this.mic?.getAudioTracks().some(track => track.readyState === 'live'); }
  get connectedCount() { return [...this.peers.values()].filter(peer => peer.pc.connectionState === 'connected').length; }
  get peerCount() { return this.peers.size; }
  get canTransmit() { return this.microphoneReady && this.ready && this.connectedCount === this.peerCount; }

  async resume() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.output = this.context.createMediaStreamDestination();
      this.context.onstatechange = () => { if (!this.ready) { this.stop(); this.onEnded(); } this.onChange(); };
    }
    for (const peer of this.peers.values()) void this.play(peer);
    await this.context.resume();
    this.onChange();
  }

  enableMicrophone() {
    if (this.microphoneRequest) return this.microphoneRequest;
    if (this.microphoneReady) return this.resume();
    if (!this.microphoneRequest) {
      const request = this.captureMicrophone();
      this.microphoneRequest = request;
      void request.finally(() => { if (this.microphoneRequest === request) this.microphoneRequest = undefined; }).catch(() => {});
    }
    return this.microphoneRequest;
  }

  private async captureMicrophone() {
    const version = this.microphoneVersion;
    const resumed = this.resume();
    void resumed.catch(() => {});
    const context = this.context;
    const cancelled = () => version !== this.microphoneVersion || context !== this.context || context.state === 'closed';
    // Request directly in the button gesture, before awaiting audio startup.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (cancelled()) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Microphone request cancelled.');
    }
    // Own the stream while audio resumes so expiry/sign-out can stop it even
    // when the browser keeps its audio context suspended.
    this.mic = stream;
    try { await resumed; } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      if (this.mic === stream) this.mic = undefined;
      throw error;
    }
    if (cancelled()) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Microphone request cancelled.');
    }
    this.micSource = this.context.createMediaStreamSource(stream);
    this.micGate = this.context.createGain();
    this.micGate.gain.value = 0;
    // Buffer the opening syllable while the 100ms transmission beep plays.
    this.delay = this.context.createDelay(0.3);
    this.delay.delayTime.value = 0.18;
    this.micSource.connect(this.micGate).connect(this.delay).connect(this.output);
    stream.getAudioTracks().forEach(track => track.onended = () => { this.stop(); this.onEnded(); this.onChange(); });
    await Promise.all([...this.peers.values()].map(peer => peer.sender?.replaceTrack(this.output.stream.getAudioTracks()[0])));
    this.onChange();
  }

  disableMicrophone() {
    ++this.microphoneVersion;
    this.microphoneRequest = undefined;
    this.stop();
    this.mic?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.micSource?.disconnect(); this.micGate?.disconnect(); this.delay?.disconnect();
    this.mic = undefined; this.micGate = undefined;
    this.onChange();
  }

  reconcile(seat: string, session: string, ownSpeaker: boolean, participants: RadioPeer[]) {
    if (seat !== this.localSeat || session !== this.localSession) this.resetPeers();
    this.localSeat = seat; this.localSession = session;
    const wanted = participants.filter(peer => peer.seat !== seat && (ownSpeaker || peer.speaker));
    for (const [key, peer] of this.peers) {
      if (!wanted.some(item => item.seat === key && item.session === peer.session)) this.removePeer(key);
    }
    for (const remote of wanted) {
      if (this.peers.has(remote.seat)) continue;
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      const peer: Peer = { pc, session: remote.session, offerId: '', playbackReady: false, queue: Promise.resolve() };
      this.peers.set(remote.seat, peer);
      pc.ontrack = event => {
        if (peer.audio) { peer.audio.onpause = null; peer.audio.pause(); peer.audio.remove(); }
        const audio = document.createElement('audio');
        audio.autoplay = true; audio.muted = true; audio.hidden = true;
        audio.setAttribute('playsinline', '');
        audio.srcObject = new MediaStream([event.track]);
        peer.audio = audio;
        audio.onpause = () => { if (this.peers.get(remote.seat) === peer) { peer.blocked = true; peer.playbackReady = false; this.onChange(); } };
        document.body.appendChild(audio);
        this.updateGates();
        void this.play(peer);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') this.removePeer(remote.seat);
        this.onChange();
      };
      if (Number(seat) < Number(remote.seat)) {
        peer.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
        peer.offerId = crypto.randomUUID();
        peer.queue = this.offer(remote.seat, peer).catch(() => this.fail(remote.seat, peer));
      }
    }
    this.onChange();
  }

  receive(seat: string, signal: RadioSignal) {
    const peer = this.peers.get(seat);
    if (!peer || signal.fromSession !== peer.session || signal.toSession !== this.localSession || peer.remoteSdp === signal.sdp) return;
    peer.remoteSdp = signal.sdp;
    peer.queue = peer.queue.then(async () => {
      if (this.peers.get(seat) !== peer) return;
      if (signal.type === 'offer' && Number(this.localSeat) > Number(seat)) {
        peer.offerId = signal.offerId;
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        const transceiver = peer.pc.getTransceivers()[0];
        if (transceiver) transceiver.direction = 'sendrecv';
        peer.sender = transceiver?.sender;
        await this.attachTrack(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        await this.publish(seat, peer);
      } else if (signal.type === 'answer' && signal.offerId === peer.offerId && peer.pc.signalingState === 'have-local-offer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      }
    }).catch(() => this.fail(seat, peer));
  }

  setFloor(floor: RadioFloor | undefined, muted: boolean) {
    this.floor = floor; this.muted = muted;
    if (this.activeToken && floor?.token !== this.activeToken) this.stop();
    this.updateGates();
  }

  transmit(floor: RadioFloor, remainingMs: number) {
    if (!this.canTransmit) throw new Error('Audio is still connecting.');
    this.activeToken = floor.token;
    const now = this.context.currentTime;
    const beep = this.context.createOscillator();
    const volume = this.context.createGain();
    beep.frequency.value = 880;
    volume.gain.setValueAtTime(0.09, now);
    volume.gain.setValueAtTime(0, now + 0.1);
    beep.connect(volume); volume.connect(this.output); volume.connect(this.context.destination);
    beep.start(now); beep.stop(now + 0.11);
    beep.onended = () => { beep.disconnect(); volume.disconnect(); };
    this.micGate.gain.setValueAtTime(1, now);
    // End slightly early so the delayed microphone tail also fits the server lease.
    this.stopTimer = setTimeout(() => { this.stop(); this.onEnded(); }, Math.max(0, remainingMs - 220));
  }

  stop() {
    clearTimeout(this.stopTimer);
    this.activeToken = undefined;
    if (this.micGate && this.context) this.micGate.gain.setValueAtTime(0, this.context.currentTime);
  }

  close() {
    this.disableMicrophone(); this.resetPeers();
    this.context?.close().catch(() => {}); this.context = undefined;
  }

  private async offer(seat: string, peer: Peer) {
    await this.attachTrack(peer);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await this.publish(seat, peer);
  }
  private async attachTrack(peer: Peer) {
    await peer.sender?.replaceTrack(this.output.stream.getAudioTracks()[0]);
  }
  private async publish(seat: string, peer: Peer) {
    // Connections are established ahead of Talk. Gather ICE into a bounded single SDP record.
    if (peer.pc.iceGatheringState !== 'complete') await new Promise<void>(resolve => {
      const timer = setTimeout(done, 5000);
      function done() { clearTimeout(timer); peer.pc.removeEventListener('icegatheringstatechange', changed); resolve(); }
      function changed() { if (peer.pc.iceGatheringState === 'complete' || peer.pc.signalingState === 'closed') done(); }
      peer.pc.addEventListener('icegatheringstatechange', changed);
    });
    if (this.peers.get(seat) !== peer || !peer.pc.localDescription) return;
    const description = peer.pc.localDescription;
    await this.onSignal(seat, { fromSession: this.localSession, toSession: peer.session, offerId: peer.offerId, type: description.type as 'offer' | 'answer', sdp: description.sdp });
  }
  private async play(peer: Peer) {
    if (!peer.audio) return;
    try { await peer.audio.play(); peer.blocked = false; peer.playbackReady = true; }
    catch { peer.blocked = true; peer.playbackReady = false; }
    this.onChange();
  }
  private updateGates() {
    for (const [seat, peer] of this.peers) {
      if (peer.audio) peer.audio.muted = this.muted || this.floor?.seat !== seat || this.floor.session !== peer.session;
    }
  }
  private fail(seat: string, peer: Peer) {
    if (this.peers.get(seat) !== peer) return;
    this.removePeer(seat); this.onError('Audio connection failed. Try Reconnect.');
  }
  private removePeer(seat: string) {
    const peer = this.peers.get(seat);
    this.peers.delete(seat);
    if (!peer) return;
    peer.pc.onconnectionstatechange = null; peer.pc.ontrack = null;
    peer.pc.close();
    if (peer.audio) { peer.audio.onpause = null; peer.audio.pause(); peer.audio.srcObject = null; peer.audio.remove(); }
  }
  private resetPeers() { for (const seat of this.peers.keys()) this.removePeer(seat); }
}
