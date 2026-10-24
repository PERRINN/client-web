import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionsService } from '../../permissions.service';
import { ChatDataService } from '../chatData.service';
import { ChatMessage } from '../chatData';
import { ChatParticipant, ChatParticipantsService, ParticipantPage } from './chatParticipants.service';

@Component({ selector: 'app-chat-participants', standalone: false,
  templateUrl: './chat-participants.component.html', styleUrls: ['./chat-participants.component.css'] })
export class ChatParticipantsComponent implements OnChanges, OnDestroy {
  @Input() chain = '';
  @Input() members: ChatParticipant[] = [];
  @Input() messages: ChatMessage[] = [];
  @Output() busyChange = new EventEmitter<boolean>();
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('addButton') addButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('keepButton') keepButton?: ElementRef<HTMLButtonElement>;
  picker = false;
  query = '';
  results: ChatParticipant[] = [];
  searched = false;
  loading = false;
  hasMore = false;
  saving = false;
  error = '';
  notice = '';
  removing: ChatParticipant | null = null;
  private context = '';
  private epoch = 0;
  private searchEpoch = 0;
  private pages = 0;
  private searchText = '';
  private cursor?: ParticipantPage['cursor'];
  private pendingId = '';
  private timer?: ReturnType<typeof setTimeout>;
  private subscription: Subscription;

  constructor(public permissions: PermissionsService, private directory: ChatParticipantsService,
    private data: ChatDataService, private zone: NgZone) {
    let identity = '';
    this.subscription = permissions.state.subscribe(state => {
      const next = `${state.uid}:${state.ready && state.isAdmin}`;
      if (identity !== next) { identity = next; this.reset(); }
    });
  }
  ngOnChanges(): void {
    if (this.context !== this.chain) { this.context = this.chain; this.reset(); }
    if (this.pendingId && this.messages.some(message => message.id === this.pendingId && message.verified)) {
      clearTimeout(this.timer); this.pendingId = ''; this.error = ''; this.notice = 'Participants updated';
      this.saving = false; this.removing = null;
      const epoch = this.epoch;
      // Inputs are applied during the parent's check; publish completion afterwards.
      queueMicrotask(() => this.zone.run(() => { if (epoch === this.epoch && !this.saving) this.busyChange.emit(false); }));
      requestAnimationFrame(() => this.addButton?.nativeElement.focus());
    }
    if (this.removing && !this.members.some(member => member.id === this.removing!.id) && !this.saving) this.removing = null;
  }
  get available(): ChatParticipant[] { return this.results.filter(person => !this.members.some(member => member.id === person.id)); }
  balanceLabel(balance?: number | null): string { return this.data.participantBalance(balance); }
  get canLoadMore(): boolean { return this.hasMore && this.pages < 10; }
  openPicker(): void {
    this.picker = true; this.removing = null; this.error = ''; this.notice = '';
    requestAnimationFrame(() => this.searchInput?.nativeElement.focus());
  }
  closePicker(): void {
    if (this.saving) return;
    this.picker = false; this.searchEpoch++; this.loading = false; this.error = '';
    requestAnimationFrame(() => this.addButton?.nativeElement.focus());
  }
  async search(more = false): Promise<void> {
    if (this.loading || this.saving || !this.permissions.current.isAdmin || more && !this.canLoadMore) return;
    const text = more ? this.searchText : this.query.trim();
    if (!text) { this.error = 'Enter a name.'; return; }
    const epoch = this.epoch, searchEpoch = ++this.searchEpoch;
    if (!more) { this.results = []; this.cursor = undefined; this.pages = 0; this.hasMore = false; this.searched = false; this.searchText = text; }
    this.loading = true; this.error = '';
    try {
      const page = await this.directory.search(text, more ? this.cursor : undefined);
      this.zone.run(() => {
        if (epoch !== this.epoch || searchEpoch !== this.searchEpoch) return;
        this.results = [...new Map([...this.results, ...page.people].map(person => [person.id, person])).values()];
        this.cursor = page.cursor; this.hasMore = page.hasMore; this.pages++; this.searched = true;
      });
    } catch { this.zone.run(() => { if (epoch === this.epoch && searchEpoch === this.searchEpoch) this.error = 'Contributors couldn’t load. Try again.'; }); }
    finally { this.zone.run(() => { if (epoch === this.epoch && searchEpoch === this.searchEpoch) this.loading = false; }); }
  }
  confirmRemoval(member: ChatParticipant): void {
    this.removing = member; this.error = ''; this.notice = '';
    requestAnimationFrame(() => this.keepButton?.nativeElement.focus());
  }
  async change(action: 'add' | 'remove', member: ChatParticipant): Promise<void> {
    if (this.saving || !this.permissions.current.ready || !this.permissions.current.isAdmin || !this.chain) return;
    if ((action === 'add') === this.members.some(person => person.id === member.id)) return;
    const epoch = this.epoch;
    this.setBusy(true); this.error = ''; this.notice = '';
    try {
      const id = await this.data.changeParticipant(this.chain, action, member);
      this.zone.run(() => {
        if (epoch !== this.epoch) return;
        this.pendingId = id;
        this.timer = setTimeout(() => this.zone.run(() => {
          if (epoch !== this.epoch) return;
          this.error = 'Update wasn’t confirmed. Check the participant list before trying again.'; this.setBusy(false);
        }), 30000);
        this.ngOnChanges();
      });
    } catch { this.zone.run(() => { if (epoch === this.epoch) { this.error = 'Participants couldn’t save. Try again.'; this.setBusy(false); } }); }
  }
  private setBusy(busy: boolean): void { this.saving = busy; this.busyChange.emit(busy); }
  private reset(): void {
    const wasSaving = this.saving, epoch = ++this.epoch;
    clearTimeout(this.timer); this.searchEpoch++; this.pendingId = ''; this.picker = false; this.removing = null;
    this.query = ''; this.results = []; this.cursor = undefined; this.pages = 0; this.hasMore = false;
    this.searched = false; this.loading = false; this.saving = false; this.error = ''; this.notice = '';
    if (wasSaving) queueMicrotask(() => this.zone.run(() => { if (epoch === this.epoch && !this.saving) this.busyChange.emit(false); }));
  }
  ngOnDestroy(): void { this.reset(); this.subscription.unsubscribe(); }
}
