import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { GreenpowerChunk, GreenpowerSample, MAX_CHUNK_WIRE_BYTES, MAX_LOAD_BYTES, MAX_PAGES, PAGE_SIZE, sampleTime } from './greenpowerData';
import { RecordingSegment, validSegments } from './greenpowerEvents';

export interface LocatedSample { day: string; chunk: string; index: number; sample: GreenpowerSample; lastInChunk?: boolean; }
export function recordingRange(entries: LocatedSample[], start: number, end: number): RecordingSegment[] {
  const ranges: RecordingSegment[] = [];
  let previous: LocatedSample | undefined, gap = true;
  for (const entry of entries) {
    const time = sampleTime(entry.sample);
    if (time < start || time > end) { gap = true; continue; }
    const source = entry.sample.source;
    if (!['echook-history', '424-phone'].includes(source)) throw new Error('This range includes an unsupported recording source.');
    const car = source === 'echook-history' ? /^echook:([A-Za-z0-9_-]+):\d+$/.exec(entry.sample.id)?.[1] : undefined;
    if (source === 'echook-history' && !car) throw new Error('The recording has no valid import reference.');
    const last = ranges.at(-1);
    if (!gap && previous && last && previous.day === entry.day && previous.sample.source === source
      && (previous.chunk === entry.chunk && previous.index + 1 === entry.index || previous.lastInChunk && Number(previous.chunk) + 1 === Number(entry.chunk) && entry.index === 0)) {
      last.lastChunk = entry.chunk; last.lastIndex = entry.index; last.lastSampleId = entry.sample.id; last.lastAt = time;
    } else ranges.push({ day: entry.day, source: source as RecordingSegment['source'], ...(car ? { importId: `echook-${car}-${entry.day}` } : {}),
      firstChunk: entry.chunk, lastChunk: entry.chunk, firstIndex: entry.index, lastIndex: entry.index,
      firstSampleId: entry.sample.id, lastSampleId: entry.sample.id, firstAt: time, lastAt: time });
    previous = entry; gap = false;
  }
  if (!validSegments(ranges)) throw new Error('Choose a range with ordered recording boundaries and at most 20 segments.');
  return ranges;
}

export interface RecordingBudget { pages: number; bytes: number; }
export function recordingBudget(): RecordingBudget { return { pages: MAX_PAGES, bytes: MAX_LOAD_BYTES }; }

/** One explicit load action shares its query/byte budget across every segment. */
export class RecordingReader {
  readonly entries: LocatedSample[] = [];
  more = true;
  private segment = 0;
  private cursor?: string;
  private readonly chunks = new Map<string, GreenpowerChunk>();
  constructor(private readonly root: firebase.firestore.CollectionReference, readonly segments: RecordingSegment[], seed: ReadonlyMap<string, GreenpowerChunk> = new Map()) {
    if (!validSegments(segments)) throw new Error('Recording ranges are invalid.');
    for (const [key, chunk] of seed) if (segments.some(segment => key.startsWith(segment.day + '/') && key.slice(11) >= segment.firstChunk && key.slice(11) <= segment.lastChunk)) this.chunks.set(key, chunk);
  }
  cachedChunks(): ReadonlyMap<string, GreenpowerChunk> { return this.chunks; }
  async load(current: () => boolean, budget = recordingBudget()) {
    while (budget.pages > 0 && this.segment < this.segments.length) {
      if (!current()) return;
      const segment = this.segments[this.segment];
      const limit = Math.min(PAGE_SIZE, Math.floor(budget.bytes / MAX_CHUNK_WIRE_BYTES));
      if (limit < 1) break;
      budget.pages--;
      // A shared boundary chunk can serve two disjoint ranges without another read.
      const next = this.cursor ? String(Number(this.cursor) + 1).padStart(10, '0') : segment.firstChunk;
      const cached = this.chunks.has(`${segment.day}/${next}`);
      let docs: { id: string; data: () => GreenpowerChunk }[];
      if (cached) {
        docs = [];
        for (let index = Number(next); docs.length < limit && index <= Number(segment.lastChunk); index++) {
          const id = String(index).padStart(10, '0'), chunk = this.chunks.get(`${segment.day}/${id}`);
          if (!chunk) break;
          docs.push({ id, data: () => chunk });
        }
      }
      else {
        let query = this.root.doc(segment.day).collection('chunks').orderBy(firebase.firestore.FieldPath.documentId()).endAt(segment.lastChunk).limit(limit);
        query = this.cursor ? query.startAfter(this.cursor) : query.startAt(segment.firstChunk);
        const result = await query.get({ source: 'server' });
        if (!current()) return;
        docs = result.docs.map(doc => ({ id: doc.id, data: () => doc.data() as GreenpowerChunk }));
      }
      if (!docs.length) throw new Error('Recording chunks are missing.');
      for (const doc of docs) {
        const chunk = doc.data(), key = `${segment.day}/${doc.id}`;
        if (!Array.isArray(chunk.samples) || chunk.samples.length > 32 || new TextEncoder().encode(JSON.stringify(chunk)).length > MAX_CHUNK_WIRE_BYTES) throw new Error('Recording chunk is invalid.');
        budget.bytes -= new TextEncoder().encode(JSON.stringify(chunk)).length;
        const expected = this.cursor ? String(Number(this.cursor) + 1).padStart(10, '0') : segment.firstChunk;
        if (doc.id !== expected) throw new Error('Recording chunks are missing.');
        const first = doc.id === segment.firstChunk ? segment.firstIndex : 0;
        const last = doc.id === segment.lastChunk ? segment.lastIndex : chunk.samples.length - 1;
        for (const [side, index] of [['first', first], ['last', last]] as const) {
          if (doc.id === segment[side + 'Chunk']) {
            const sample = chunk.samples[index];
            if (!sample || sample.id !== segment[side + 'SampleId'] || sampleTime(sample) !== segment[side + 'At']) throw new Error('Recording boundaries changed.');
          }
        }
        if (first > last) throw new Error('Recording range is empty.');
        const entries = chunk.samples.slice(first, last + 1).map((sample, offset) => ({ day: segment.day, chunk: doc.id, index: first + offset, sample, lastInChunk: first + offset === chunk.samples.length - 1 }));
        if (entries.some(entry => entry.sample.source !== segment.source)) throw new Error('Recording source changed.');
        this.chunks.set(key, chunk); this.entries.push(...entries); this.cursor = doc.id;
      }
      if (this.cursor === segment.lastChunk) { this.segment++; this.cursor = undefined; }
    }
    this.more = this.segment < this.segments.length;
  }
}
