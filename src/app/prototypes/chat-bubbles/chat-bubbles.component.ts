import { ChatEvent } from '../chat-event/chatEvent';
import { ChatEventEditorComponent } from '../chat-event/chat-event-editor.component';
import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { SidebarConversationsService } from '../../sidebarConversations.service';
import { ChatComposerComponent, PrototypeChatDraft } from '../chat-composer/chat-composer.component';
import { BubbleMessage, chatImageError, continuesMessageGroup, messageDateLabel } from './chatBubbleData';
import { ChatBubbleReadService } from './chatBubbleRead.service';
import { ChatBubbleDataService } from './chatBubbleData.service';

@Component({
  selector: 'app-chat-bubbles',
  providers: [ChatBubbleReadService],
  templateUrl: './chat-bubbles.component.html',
  styleUrls: ['./chat-bubbles.component.css'],
  standalone: false
})
export class ChatBubblesComponent implements AfterViewInit, OnDestroy {
  readonly dateLabel = messageDateLabel;
  event: ChatEvent | null = null;
  eventSaving = false;
  @ViewChild('eventEditor') eventEditor?: ChatEventEditorComponent;
  @ViewChild('subjectInput') subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('editDetailsButton') editDetailsButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('messageList') messageList?: ElementRef<HTMLElement>;
  @ViewChild('detailsClose') detailsClose?: ElementRef<HTMLButtonElement>;
  @ViewChild('detailsTrigger') detailsTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('imageDialog') imageDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild(ChatComposerComponent) composer?: ChatComposerComponent;
  editingDetails = false;
  savingDetails = false;
  subjectDraft = '';
  detailsError = '';
  detailsNotice = '';
  imagePreview = '';
  private detailsImage?: File;
  private originalSubject = '';
  state = 'loading';
  chain = '';
  title = 'Conversation';
  avatar = '';
  detailsOpen = false;
  awayFromLatest = false;
  activeImage = '';
  activeImageName = '';
  imageError = false;
  sentCount = 0;
  signedIn = false;
  sending = false;
  sendError = '';
  loadMoreError = '';
  loadingMore = false;
  hasMore = false;
  unreadId = '';
  messages: BubbleMessage[] = [];
  members: { id: string; name: string; avatarName: string; avatar: string }[] = [];
  private limit = 30;
  private scrollTarget = '';
  private pendingAnchor?: { top: number; height: number };
  private resizeObserver?: ResizeObserver;
  private subscriptions = new Subscription();
  private messageSubscription?: Subscription;
  private latestSubscription?: Subscription;

  constructor(private route: ActivatedRoute, private router: Router, private data: ChatBubbleDataService, private sidebar: SidebarConversationsService, private zone: NgZone, public readonly reads: ChatBubbleReadService) {
    this.subscriptions.add(route.paramMap.subscribe(params => {
      this.messageSubscription?.unsubscribe(); this.latestSubscription?.unsubscribe(); this.reads.reset();
      this.resetDetailsEditor(); this.savingDetails = false; this.detailsNotice = '';
      this.event = null; this.eventSaving = false;
      this.chain = params.get('id') || ''; this.messages = []; this.members = [];
      this.state = 'loading'; this.title = 'Conversation'; this.avatar = ''; this.unreadId = '';
      this.detailsOpen = false; this.awayFromLatest = false; this.sendError = ''; this.loadMoreError = '';
      this.hasMore = false; this.loadingMore = false; this.pendingAnchor = undefined; this.composer?.clearDraft();
      this.scrollTarget = this.route.snapshot.queryParamMap.get('scroll') || '';
      this.limit = this.scrollTarget ? 100 : 30;
      if (this.chain) this.loadMessages();
      else this.latestSubscription = this.sidebar.latestHuman.pipe(filter(value => value.status !== 'loading'), take(1)).subscribe(value => this.zone.run(() => {
        if (value.status === 'error') this.state = 'error';
        else if (!value.chain) this.state = 'empty';
        else void this.router.navigate(['/prototypes/chat-bubbles', value.chain], { replaceUrl: true });
      }));
    }));
  }

  ngAfterViewInit(): void {
    if (this.messageList) this.reads.attach(this.messageList.nativeElement);
    this.resizeObserver = new ResizeObserver(() => this.onImageLoad());
    if (this.messageList) this.resizeObserver.observe(this.messageList.nativeElement);
  }

  private loadMessages(anchor?: { top: number; height: number }): void {
    this.messageSubscription?.unsubscribe();
    this.messageSubscription = this.data.watch(this.chain, this.limit).subscribe({
      next: chat => this.zone.run(() => {
        const stick = !this.awayFromLatest, entering = this.state === 'loading';
        this.event = chat.event; this.messages = chat.messages; this.title = chat.title; this.members = chat.members; this.avatar = chat.avatar;
        this.unreadId = this.reads.update(this.chain, chat); this.hasMore = chat.hasMore; this.signedIn = chat.signedIn;
        if (!chat.signedIn && this.editingDetails) this.resetDetailsEditor();
        this.loadingMore = false; this.loadMoreError = ''; this.state = this.messages.length ? 'ready' : 'empty';
        if (anchor) {
          this.pendingAnchor = anchor; anchor = undefined;
          requestAnimationFrame(() => this.restoreAnchor());
        } else if (this.scrollTarget) this.onImageLoad();
        else if (stick) {
          if (entering && this.unreadId) this.scrollTarget = this.unreadId;
          if (this.scrollTarget) this.onImageLoad(); else this.jumpToLatest();
        }
      }),
      error: () => this.zone.run(() => {
        this.loadingMore = false;
        if (anchor) { this.loadMoreError = 'Earlier messages couldn’t load.'; this.limit -= 15; }
        else this.state = 'error';
      })
    });
  }

  loadMore(): void {
    const list = this.messageList?.nativeElement;
    if (!list || this.loadingMore) return;
    this.loadingMore = true; this.loadMoreError = ''; this.limit += 15;
    this.awayFromLatest = true;
    this.loadMessages({ top: list.scrollTop, height: list.scrollHeight });
  }

  retry(): void {
    this.state = 'loading';
    if (this.chain) this.loadMessages();
    else this.subscriptions.add(this.sidebar.human(1).pipe(take(1)).subscribe({
      next: rows => this.zone.run(() => {
        const chain = rows[0]?.payload.doc.data().chain;
        if (chain) void this.router.navigate(['/prototypes/chat-bubbles', chain], { replaceUrl: true });
        else this.state = 'empty';
      }), error: () => this.zone.run(() => this.state = 'error')
    }));
  }

  async send(draft: PrototypeChatDraft): Promise<void> {
    if (this.sending || !this.signedIn || !this.chain) return;
    const chain = this.chain;
    this.sending = true; this.sendError = '';
    try {
      await this.data.send(chain, draft);
      this.zone.run(() => { if (this.chain === chain) { this.composer?.clearDraft(); this.sentCount++; this.jumpToLatest(); } });
    } catch (error) {
      this.zone.run(() => {
        if (this.chain === chain) this.sendError = error instanceof Error && error.message.startsWith('Sign in') ? error.message : 'Message couldn’t send. Try again.';
      });
    } finally { this.zone.run(() => this.sending = false); }
  }

  onScroll(): void {
    const list = this.messageList?.nativeElement;
    if (list) this.awayFromLatest = list.scrollHeight - list.clientHeight - list.scrollTop > 100;
    this.scrollTarget = '';
  }

  get showLatest(): boolean {
    const list = this.messageList?.nativeElement;
    return !!list && list.scrollHeight - list.clientHeight - list.scrollTop > Math.max(300, list.clientHeight);
  }

  private restoreAnchor(): void {
    const list = this.messageList?.nativeElement;
    if (!list?.clientHeight || !this.pendingAnchor) return;
    list.scrollTop = this.pendingAnchor.top + list.scrollHeight - this.pendingAnchor.height;
    this.pendingAnchor = undefined;
  }

  onImageLoad(): void {
    if (this.pendingAnchor) { this.restoreAnchor(); return; }
    if (this.scrollTarget) {
      requestAnimationFrame(() => {
        const target = document.getElementById(`bubble-${this.scrollTarget}`);
        if (target) target.scrollIntoView({ block: 'center' });
      });
    } else if (!this.awayFromLatest) this.jumpToLatest();
  }

  jumpToLatest(): void {
    this.scrollTarget = '';
    requestAnimationFrame(() => {
      const list = this.messageList?.nativeElement;
      if (list) list.scrollTop = list.scrollHeight;
      this.awayFromLatest = false;
    });
  }

  get hasDetailsChanges(): boolean { return this.subjectDraft.trim() !== this.originalSubject || !!this.detailsImage; }

  editDetails(): void {
    if (!this.signedIn) return;
    this.originalSubject = this.title; this.subjectDraft = this.title;
    this.detailsError = ''; this.detailsNotice = ''; this.editingDetails = true;
    requestAnimationFrame(() => this.subjectInput?.nativeElement.focus());
  }

  chooseChatImage(event: Event): void {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (!file || this.savingDetails) return;
    this.detailsError = chatImageError(file);
    if (this.detailsError) return;
    this.clearChatImage(); this.detailsImage = file; this.imagePreview = URL.createObjectURL(file);
  }

  clearChatImage(): void {
    if (this.imagePreview) URL.revokeObjectURL(this.imagePreview);
    this.imagePreview = ''; this.detailsImage = undefined;
  }

  cancelDetailsEdit(): void {
    if (this.savingDetails) return;
    this.resetDetailsEditor();
    requestAnimationFrame(() => this.editDetailsButton?.nativeElement.focus());
  }

  private resetDetailsEditor(): void {
    this.clearChatImage(); this.editingDetails = false; this.detailsError = '';
  }

  async saveDetails(): Promise<void> {
    if (!this.signedIn || this.savingDetails || !this.hasDetailsChanges || !this.subjectDraft.trim()) return;
    if (this.title !== this.originalSubject && this.subjectDraft.trim() !== this.title) {
      this.detailsError = 'The subject changed. Cancel and try again.'; return;
    }
    const chain = this.chain;
    this.savingDetails = true; this.detailsError = '';
    try {
      await this.data.updateDetails(chain, {
        ...(this.subjectDraft.trim() === this.originalSubject ? {} : { subject: this.subjectDraft.trim() }),
        ...(this.detailsImage ? { image: this.detailsImage } : {})
      });
      this.zone.run(() => {
        if (this.chain !== chain) return;
        this.resetDetailsEditor(); this.detailsNotice = 'Update sent';
        requestAnimationFrame(() => this.editDetailsButton?.nativeElement.focus());
      });
    } catch {
      this.zone.run(() => { if (this.chain === chain) this.detailsError = 'Changes couldn’t save. Try again.'; });
    } finally { this.zone.run(() => { if (this.chain === chain) this.savingDetails = false; }); }
  }

  onDetailsEscape(event: Event): void {
    event.stopPropagation();
    if (this.editingDetails) this.cancelDetailsEdit(); else this.closeDetails();
  }

  openEventDetails(): void {
    if (!this.detailsOpen) this.toggleDetails();
    requestAnimationFrame(() => this.eventEditor?.focus());
  }

  toggleDetails(): void {
    if (this.detailsOpen) { this.closeDetails(); return; }
    this.detailsOpen = true; this.reads.paused = true; this.reads.scan();
    requestAnimationFrame(() => this.detailsClose?.nativeElement.focus());
    if (!this.awayFromLatest) this.jumpToLatest();
  }

  closeDetails(): void {
    if (this.savingDetails || this.eventSaving) return;
    this.resetDetailsEditor(); this.detailsNotice = '';
    this.detailsOpen = false; this.reads.paused = false; this.reads.scan();
    requestAnimationFrame(() => this.detailsTrigger?.nativeElement.focus());
    if (!this.awayFromLatest) this.jumpToLatest();
  }

  isContinued(index: number): boolean {
    return continuesMessageGroup(this.messages[index - 1], this.messages[index], this.unreadId);
  }

  hideAvatar(event: Event): void { (event.target as HTMLImageElement).hidden = true; }

  openImage(message: BubbleMessage): void {
    this.activeImage = message.originalImage; this.activeImageName = message.imageName;
    this.imageError = false; this.imageDialog?.nativeElement.showModal();
  }

  ngOnDestroy(): void {
    this.resetDetailsEditor();
    this.subscriptions.unsubscribe(); this.messageSubscription?.unsubscribe(); this.latestSubscription?.unsubscribe();
    this.resizeObserver?.disconnect();
  }
}
