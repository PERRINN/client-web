import { Injectable } from '@angular/core';

export const VOICE_QUEUE_LIMIT = 10;
export const VOICE_AUDIO_LIMIT = 960044;
// Total upload preparation budget; reopening and network flaps do not reset it.
export const VOICE_REQUEST_LIMIT = 3;
export interface VoiceRecording {
  id: string;
  owner: string;
  createdAt: number;
  // New recordings own their bytes; Blob remains readable for existing queues.
  audio: ArrayBuffer | Blob;
  attempts: number;
  nextAt: number;
  check: boolean;
  leaseId?: string;
  leaseUntil?: number;
  error?: string;
  received?: boolean;
  eventId?: string;
  conversationId?: string;
  retryWindow?: number;
}

@Injectable({ providedIn: 'root' })
export class VoiceQueueStore {
  private opening?: Promise<IDBDatabase>;

  private open(): Promise<IDBDatabase> {
    if (!this.opening) {
      this.opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('perrinn-voice-queue', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
        request.onsuccess = () => {
          const db = request.result;
          db.onclose = () => { this.opening = undefined; };
          db.onversionchange = () => { db.close(); this.opening = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Close other PERRINN tabs to open recording storage.'));
      }).catch(error => { this.opening = undefined; throw error; });
    }
    return this.opening;
  }

  async list(owner: string): Promise<{ items: VoiceRecording[]; total: number }> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly'), store = tx.objectStore('recordings');
      // The store has a device-wide hard cap; do not enumerate an unbounded store.
      const rows = store.getAll(undefined, VOICE_QUEUE_LIMIT);
      const count = store.count();
      tx.oncomplete = () => resolve({
        items: (rows.result as VoiceRecording[]).filter(item => item.owner === owner).sort((a, b) => a.createdAt - b.createdAt),
        total: count.result
      });
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not load recordings.'));
    });
  }

  async add(item: VoiceRecording): Promise<void> {
    const size = item.audio instanceof ArrayBuffer ? item.audio.byteLength : item.audio.size;
    if (!item.owner || !Number.isFinite(size) || size > VOICE_AUDIO_LIMIT || size < 12844) throw new Error('Invalid recording.');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite'), store = tx.objectStore('recordings');
      let full = false;
      const existing = store.get(item.id);
      existing.onsuccess = () => {
        if (existing.result) {
          if (existing.result.owner !== item.owner) tx.abort();
          return; // A previous commit acknowledgement may have been lost.
        }
        const count = store.count();
        count.onsuccess = () => {
          if (count.result >= VOICE_QUEUE_LIMIT) { full = true; tx.abort(); }
          else store.add(item);
        };
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error(full ? 'Recording storage is full.' : 'Could not save on this device. Keep this page open.'));
    });
  }

  // Read/compare/write in one transaction also coordinates different tabs.
  async change(id: string, owner: string, update: (item: VoiceRecording) => VoiceRecording | null | undefined): Promise<VoiceRecording | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readwrite'), store = tx.objectStore('recordings');
      const request = store.get(id);
      let result: VoiceRecording | undefined;
      let failure: unknown;
      // Abort the real transaction before the service deadline. An Rx timeout
      // alone leaves IndexedDB work alive and can block every subsequent write.
      const timer = setTimeout(() => {
        failure = new DOMException('Recording update timed out.', 'TimeoutError');
        tx.abort();
      }, 4500);
      request.onsuccess = () => {
        try {
          const item = request.result as VoiceRecording | undefined;
          if (!item || item.owner !== owner) return;
          const next = update(item);
          if (next === null) { store.delete(id); result = item; }
          else if (next) { store.put(next); result = next; }
        } catch (error) {
          // put() can throw synchronously (for example when cloning a damaged
          // legacy Blob). Do not leave the promise pending or report a commit.
          failure = error; tx.abort();
        }
      };
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => {
        clearTimeout(timer); reject(failure || tx.error || new Error('Could not update recording storage.'));
      };
    });
  }
}
