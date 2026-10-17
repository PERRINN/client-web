import { imagePostedMillis, ImageTimestamp } from './imageTime';
import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import firebase from 'firebase/compat/app';

export interface ViewerImage { src: string; name?: string; chain?: string; id?: string; imageTimestamp?: string; subject?: string; postedAt?: number; }
export interface ImageRecord { serverTimestamp?: ImageTimestamp; chatSubject?: string; chatImageTimestamp?: string; chain?: string; name?: string; chatImageUrlOriginal?: string; chatImageUrlMedium?: string; chatImageUrlThumb?: string; }
type Cursor = firebase.firestore.DocumentSnapshot<ImageRecord>;
type Direction = -1 | 1;

export function recordImage(id: string, record: ImageRecord): ViewerImage | null {
  const src = record.chatImageUrlOriginal || record.chatImageUrlMedium || record.chatImageUrlThumb;
  return src ? { id, chain: record.chain, src, name: record.name ? `Image from ${record.name}` : 'Shared image', imageTimestamp: record.chatImageTimestamp, subject: record.chatSubject, postedAt: imagePostedMillis(record.serverTimestamp) } : null;
}

@Injectable({ providedIn: 'root' })
export class ImageViewerService {
  readonly changed = new Subject<void>();
  images: ViewerImage[] = [];
  index = 0;
  opened = false;
  loading = false;
  error = '';
  private generation = 0;
  private cursors: Partial<Record<Direction, Cursor>> = {};
  private ended: Partial<Record<Direction, boolean>> = {};
  private retryDirection: Direction = -1;
  constructor(private afs: AngularFirestore) {}
  get current(): ViewerImage | undefined { return this.images[this.index]; }
  canMove(direction: Direction): boolean {
    return direction < 0 ? this.index > 0 || this.canFetch(direction) : this.index < this.images.length - 1 || this.canFetch(direction);
  }
  private canFetch(direction: Direction): boolean { return !!this.current?.chain && !!this.current?.id && !this.ended[direction]; }
  open(image: ViewerImage, loaded: ViewerImage[] = []): void {
    if (!image.src) return;
    const images = loaded.filter(item => item.src && item.chain === image.chain && item.id && item.imageTimestamp)
      .sort((a, b) => a.imageTimestamp < b.imageTimestamp ? -1 : a.imageTimestamp > b.imageTimestamp ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.generation++; this.images = images.some(item => item.id === image.id) ? images : [{ ...image }];
    this.index = this.images.findIndex(item => item.id === image.id); this.cursors = {}; this.ended = {};
    this.error = ''; this.loading = false; this.opened = true; this.changed.next();
  }
  close(): void {
    this.generation++; this.opened = false; this.images = []; this.loading = false; this.error = ''; this.changed.next();
  }
  retry(): void { void this.move(this.retryDirection); }
  async move(direction: Direction): Promise<void> {
    if (this.loading || !this.opened || !this.canMove(direction)) return;
    this.error = ''; this.retryDirection = direction;
    const next = this.index + direction;
    if (next >= 0 && next < this.images.length) { this.index = next; this.changed.next(); return; }
    const generation = this.generation, selected = direction < 0 ? this.images[0] : this.images[this.images.length - 1];
    this.loading = true; this.changed.next();
    try {
      let cursor = this.cursors[direction];
      if (!cursor) {
        cursor = await this.afs.firestore.collection('PERRINNMessages').doc(selected.id).get() as Cursor;
        if (generation !== this.generation) return;
        if (!cursor.exists || cursor.data()?.chain !== selected.chain || typeof cursor.get('chatImageTimestamp') !== 'string' || !cursor.get('chatImageTimestamp')) {
          throw new Error('Unavailable image position');
        }
      }
      // A single image-only page per action; no scan through ordinary messages.
      const page = await this.afs.firestore.collection('PERRINNMessages').where('chain', '==', selected.chain)
        .where('chatImageTimestamp', '>', '').orderBy('chatImageTimestamp', direction < 0 ? 'desc' : 'asc')
        .startAfter(cursor).limit(25).get();
      if (generation !== this.generation) return;
      const images = page.docs.map(doc => recordImage(doc.id, doc.data())).filter((image): image is ViewerImage => !!image)
        .filter(image => !this.images.some(existing => existing.id === image.id));
      if (page.size < 25) this.ended[direction] = true;
      if (page.size) this.cursors[direction] = page.docs[page.size - 1];
      if (images.length) {
        for (const image of images) image.subject = selected.subject || image.subject;
        if (direction < 0) { this.images.unshift(...images.reverse()); this.index = images.length - 1; }
        else { this.index = this.images.length; this.images.push(...images); }
      }
    } catch {
      if (generation === this.generation) this.error = 'Images couldn’t load.';
    } finally {
      if (generation === this.generation) { this.loading = false; this.changed.next(); }
    }
  }
}
