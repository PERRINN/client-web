import { Component, NgZone, ViewChild, ElementRef, OnDestroy, HostListener } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from '../userInterface.service'
import { AngularFireStorage } from '@angular/fire/compat/storage'
import firebase from 'firebase/compat/app'
import { map, tap, take } from 'rxjs/operators';

@Component({
  selector: 'chat',
  templateUrl: 'chat.component.html'
})

export class ChatComponent implements OnDestroy {
  @ViewChild('msgBox') msgBox!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('chatTopBar') chatTopBar!: ElementRef;
  @ViewChild('chatComposer') chatComposer?: ElementRef<HTMLDivElement>;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;
  draftMessage = ''
  imageTimestamp: string | null = null
  imageDownloadUrl: string | null = null
  chatProfileImageTimestamp: string | null = null
  chatProfileImageDownloadUrl: string | null = null
  transactionAmount: number | null = null
  transactionCode: string | null = null
  transactionReference: string | null = null
  transactionUser: string | null = null
  transactionUserName: string | null = null
  messageNumberDisplay = 0
  lastChatVisitTimestamp = 0
  previousMessageServerTimestamp: any = null
  previousMessageUser = ''
  messages!: Observable<any[]>
  teams: Observable<any[]> | null = null
  searchFilter: string | null = null
  lastSeenServerTimestampMessage = 0
  lastSeenMessageId: string | null = null
  chatSubject = ''
  chatLastMessageObj: any = null
  chatChain = ''
  showChatDetails = false
  math: any = Math
  eventDateList: any = null
  eventDateStart: any = null
  eventDateEnd: any = null
  eventDescription = ''
  eventDuration = 0
  eventLocation = ''
  fund: any = null
  fundAmountUserCurrency: any = null;
  messageOptionsOpenFor: string | null = null
  showMessageJsonModal = false
  selectedMessageJsonFormatted = ''
  showCancelFundModal = false
  showCancelEventModal = false
  lastRead: string | null = null
  showImageGallery = false
  selectedDate = 0
  selectedTime = 0
  eventDateListShort: any = null;
  eventTimeList: any = null;
  testDay: any = null;
  dayOfToday = 0;
  dateOfThatDay = new Date();
  dateOfThisDay = new Date();
  midnightOfThatDay: any = null;
  midnightOfThisDay: any = null;
  theDate: any = null;
  eventDescriptionChoice = '';
  eventDurationChoice = 0;
  eventLocationChoice = '';
  googleMeet = "https://meet.google.com/ebp-djfh-aht";
  containerTop = 0;
  containerBottom = 0;
  containerLeft = 0;
  containerWidth = 0;
  isLoadMoreDisabled = false;
  private offsetsRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingLoadMoreAnchorRestore = false;
  private pendingMessageScroll: string | null = null;
  private loadMoreAnchorTop = 0;
  private loadMoreAnchorHeight = 0;

  private scheduleOffsetsRefresh = () => {
    this.updateFixedOffsets();
    if (this.offsetsRefreshTimeout) clearTimeout(this.offsetsRefreshTimeout);
    this.offsetsRefreshTimeout = setTimeout(() => this.updateFixedOffsets(), 180);
  }

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private storage:AngularFireStorage,
    private zone: NgZone,
  ) {
      this.math = Math
      this.UI.loading = true
      this.lastSeenServerTimestampMessage = 0
      this.lastSeenMessageId = null
      this.route.params.subscribe(params => {
          this.resetChat()
        this.lastRead = null
        this.chatChain = params.id
        this.messageOptionsOpenFor = null
        this.showMessageJsonModal = false
        this.selectedMessageJsonFormatted = ''
        this.showCancelFundModal = false
        this.showCancelEventModal = false
        this.chatLastMessageObj = {}
        this.previousMessageServerTimestamp = { seconds: this.UI.nowSeconds * 1000 }
        this.previousMessageUser = ''
        const scrollKey = this.route.snapshot.queryParams['scroll'];
        if (scrollKey) {
          this.pendingMessageScroll = scrollKey;
          this.messageNumberDisplay = 100;
        } else {
          this.messageNumberDisplay = 15;
        }
        this.chatSubject = ''
        this.eventDescription = '';
        this.eventDuration = 1;
        this.eventLocation = this.googleMeet;
        this.transactionAmount = null;
        this.transactionCode = null;
        this.transactionReference = null;
        this.transactionUser = null;
        this.transactionUserName = null;
        this.fund = {
          description: 'add a description',
          amountGBPTarget: 0,
          daysLeft: 0
        }
        this.fundAmountUserCurrency = 0;
        this.loadLastSeen(params.id).then(() => this.refreshMessages(params.id))
        this.refresheventDateList()
      })
    }

  private async loadLastSeen(chain: string): Promise<void> {
    if (!this.UI.currentUser || !chain) {
      this.lastSeenServerTimestampMessage = 0;
      this.lastSeenMessageId = null;
      return;
    }
    try {
      const doc = await this.afs.firestore
        .collection('lastSeen')
        .doc(this.UI.currentUser)
        .collection('chats')
        .doc(chain)
        .get();
      const data = (doc.data() || {}) as any;
      this.lastSeenMessageId = data.messageId || null;
      this.lastSeenServerTimestampMessage = this.toMillis(data.serverTimestamp || null);
    } catch {
      this.lastSeenServerTimestampMessage = 0;
      this.lastSeenMessageId = null;
    }
  }

  private toMillis(value: any): number {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    return 0;
  }

  private isMessageReadByLastSeen(messageData: any): boolean {
    const messageTimestampMessage = this.toMillis(messageData?.serverTimestamp);
    return !!this.lastSeenServerTimestampMessage && messageTimestampMessage > 0 && messageTimestampMessage <= this.lastSeenServerTimestampMessage;
  }

  private updateLastReadDivider(changes: any[]) {
    this.lastRead = null;
    let nextMessageRead = true;
    changes.forEach(c => {
      const currentMessageRead = this.isMessageReadByLastSeen(c.payload.doc.data());
      if (this.UI.currentUser && !this.lastRead && !nextMessageRead && currentMessageRead) this.lastRead = c.payload.doc.id;
      nextMessageRead = currentMessageRead;
    });
  }

  private saveLastSeen(chain: string, messageId: string, serverTimestamp: any) {
    if (!this.UI.currentUser || !chain || !messageId) return;
    const timestampMessage = this.toMillis(serverTimestamp);
    if (!timestampMessage) return;
    const isCursorAdvanced = timestampMessage > this.lastSeenServerTimestampMessage
      || (timestampMessage === this.lastSeenServerTimestampMessage && messageId !== this.lastSeenMessageId);
    if (!isCursorAdvanced) return;

    this.lastSeenServerTimestampMessage = timestampMessage;
    this.lastSeenMessageId = messageId;

    this.afs.firestore
      .collection('lastSeen')
      .doc(this.UI.currentUser)
      .collection('chats')
      .doc(chain)
      .set({
        messageId,
        serverTimestamp: firebase.firestore.Timestamp.fromMillis(timestampMessage),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
  }

  onDateChange(event: any) {
    this.eventTimeListInit();
    //Search the hour:min corresponding to the timeslot previously selected to reinject it as the current selected timeslot (on another day)
    this.dateOfThatDay = new Date(Number(this.selectedTime));
    this.dateOfThisDay = new Date(Number(this.selectedDate));
    this.midnightOfThatDay = new Date(this.dateOfThatDay.getFullYear(), this.dateOfThatDay.getMonth(), this.dateOfThatDay.getDate());
    this.midnightOfThisDay = new Date(this.dateOfThisDay.getFullYear(), this.dateOfThisDay.getMonth(), this.dateOfThisDay.getDate());
    this.selectedTime = this.midnightOfThisDay.getTime() + (this.dateOfThatDay.getTime() - this.midnightOfThatDay.getTime());
  }

  ngOnInit(){
    this.refreshSearchLists()
  }

  ngAfterViewInit() {
    this.scheduleOffsetsRefresh();
    window.addEventListener('resize', this.scheduleOffsetsRefresh);
    window.addEventListener('orientationchange', this.scheduleOffsetsRefresh);
    window.visualViewport?.addEventListener('resize', this.scheduleOffsetsRefresh);
    window.visualViewport?.addEventListener('scroll', this.scheduleOffsetsRefresh);
    document.addEventListener('focusout', this.scheduleOffsetsRefresh, true);
    document.addEventListener('focusin', this.scheduleOffsetsRefresh, true);
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.scheduleOffsetsRefresh);
    window.removeEventListener('orientationchange', this.scheduleOffsetsRefresh);
    window.visualViewport?.removeEventListener('resize', this.scheduleOffsetsRefresh);
    window.visualViewport?.removeEventListener('scroll', this.scheduleOffsetsRefresh);
    document.removeEventListener('focusout', this.scheduleOffsetsRefresh, true);
    document.removeEventListener('focusin', this.scheduleOffsetsRefresh, true);
    if (this.offsetsRefreshTimeout) clearTimeout(this.offsetsRefreshTimeout);
  }

  updateFixedOffsets = () => {
    const secondary = document.getElementById('secondary_container');
    if (!secondary) return;

    const r = secondary.getBoundingClientRect();
    const main = document.getElementById('main_container')?.getBoundingClientRect();
    const viewportOffsetTop = window.visualViewport?.offsetTop || 0;
    const visualViewportHeight = window.visualViewport?.height || window.innerHeight;
    const rawBottomOffset = Math.max(0, window.innerHeight - (visualViewportHeight + viewportOffsetTop));

    const activeEl = document.activeElement as HTMLElement | null;
    const isEditableFocused = !!activeEl && (
      activeEl.tagName === 'INPUT'
      || activeEl.tagName === 'TEXTAREA'
      || activeEl.tagName === 'SELECT'
      || activeEl.isContentEditable
    );
    const keyboardLikelyOpen = isEditableFocused && (window.innerHeight - visualViewportHeight > 120);

    const isDesktop = window.innerWidth >= 900;
    this.containerTop = Math.max(0, (main?.top ?? r.top));
    this.containerBottom = isDesktop ? (23 + rawBottomOffset) : (keyboardLikelyOpen ? rawBottomOffset : 0);
    this.containerLeft = r.left;
    this.containerWidth = r.width;
  };

  showImageGalleryClick(event?: Event) {
    event?.stopPropagation()
    this.showImageGallery = !this.showImageGallery
    this.refreshMessages(this.chatLastMessageObj.chain || this.chatChain)
  }

  loadMore() {
    this.captureLoadMoreAnchor();
    this.UI.loading = true
    this.messageNumberDisplay += 15
    this.refreshMessages(this.chatLastMessageObj.chain || this.chatChain)
  }

  refresheventDateList() {
    var i
    this.eventDateList = [];
    this.eventDateListShort = [];
    for (i = 0; i < 2200; i++) {
      this.eventDateList[i] = (Math.ceil(this.UI.nowSeconds / 3600) + i / 2) * 3600000;
      if (this.math.round(this.eventDateList[i]/3600000/24)==(this.eventDateList[i]/3600000/24)) {
        this.eventDateListShort[i] = (Math.ceil(this.UI.nowSeconds / 3600) + i / 2) * 3600000;
      }
    }
    this.eventDateListShort = this.eventDateListShort.filter((item: any) => item !== null && item !== undefined);
    this.eventDateListShort = [Math.floor(this.UI.nowSeconds / 3600 / 24)*24*3600000, ...this.eventDateListShort];
  }

  eventTimeListInit() {
    this.eventTimeList = [];
    if (this.selectedDate != undefined && this.selectedDate > (this.UI.nowSeconds*1000 - 3600000)) {
      for (let j = 0; j < 48; j++) {
        this.eventTimeList[j] = this.selectedDate*1 + j * 3600000 / 2;
      }
    }
    else {
      for (let j = 0; j < 48; j++) {
        this.eventTimeList[j] = Math.floor(this.UI.nowSeconds / 3600 / 24)*24*3600000 + j * 3600000 / 2;
      }
    }
    //Adding 48 timeslots before the first of the current list
    for (let i=0; i < 48; i++) {
      this.eventTimeList = [this.eventTimeList[0]-1800000, ...this.eventTimeList];
    }
    //Suppression of every time slot which is 'the day after' or 'the day before' in the second dropdown menu
    this.dayOfToday = new Date(this.eventTimeList[48]).getDate();
    this.testDay = [];
    for (let j=0; j < 96; j++) {
      this.eventTimeList[j] = new Date(this.eventTimeList[j]);
      this.testDay[j] = this.eventTimeList[j].getDate();
      if (this.testDay[j] != this.dayOfToday) {
        this.eventTimeList[j] = null;
      }
      else {
        this.eventTimeList[j] = (this.eventTimeList[j]).getTime();
      }
    }
    this.eventTimeList = this.eventTimeList.filter((item: any) => item !== null);
    //Suppression of every time slot which is too much 'in the past' compared to current time in second dropdown menu
    for (let j=0; j < this.eventTimeList.length; j++) {
      if (this.eventTimeList[j] < this.UI.nowSeconds * 1000 - 5400000) {
        this.eventTimeList[j] = null;
      }
    }
    this.eventTimeList = this.eventTimeList.filter((item: any) => item !== null);
  }

  selectedDateInit() {
    this.eventDescriptionChoice = this.eventDescription;
    this.eventDurationChoice = this.eventDuration;
    this.eventLocationChoice = this.eventLocation;
    this.selectedTime = this.eventDateStart;
    if (this.eventDateStart != undefined && this.eventDateStart > (this.UI.nowSeconds*1000 - 3600000)) {
      this.theDate = new Date(Number(this.eventDateStart));
      this.selectedDate = new Date(this.theDate.getFullYear(), this.theDate.getMonth(), this.theDate.getDate()).getTime() - new Date().getTimezoneOffset()*60000;
    }
    else {
      this.selectedDate = this.eventDateListShort[0];
    }
  }

  refreshMessages(chain: string) {
    if (!this.showImageGallery) this.messages = this.afs.collection('PERRINNMessages', ref => ref
      .where('chain', '==', chain)
      .orderBy('serverTimestamp', 'desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes => {
      this.UI.loading = false
      this.isLoadMoreDisabled = changes.length < this.messageNumberDisplay;
      this.updateLastReadDivider(changes)
      changes.forEach(c => {
        const row = c.payload.doc.data() as any;
        if (row['lastMessage']) {
          this.saveLastSeen(chain, c.payload.doc.id, row['serverTimestamp'])
          this.chatLastMessageObj = row
          this.chatSubject = row['chatSubject']
          this.eventDescription = row['eventDescription']
          this.eventDateStart = row['eventDateStart']
          this.eventDateEnd = row['eventDateEnd']
          this.eventDuration = row['eventDuration'] || this.eventDuration
          if (this.eventDuration != null) this.eventDuration = Math.round(this.eventDuration * 100) / 100;
          this.eventLocation = row['eventLocation'] || this.eventLocation
          if (row['fund']) this.fund = JSON.parse(JSON.stringify(row['fund']));
          if (this.fund) {
            if (this.fund.amountGBPTarget != null) this.fund.amountGBPTarget = Math.round(this.fund.amountGBPTarget * 100) / 100;
            if (this.fund.amountGBPTarget < 0.01) this.fund.daysLeft = 0;
            if (this.fund.daysLeft < 0) this.fund.daysLeft = 0;
            if (this.fund.daysLeft != null) this.fund.daysLeft = Math.round(this.fund.daysLeft);
          }
          this.updateFundAmountUserCurrency();
          this.selectedDateInit();
          this.eventTimeListInit();
        }
      })
        return changes.reverse().map(c => ({
          key: c.payload.doc.id,
          payload: c.payload.doc.data()
        }))
      }),
      tap(() => {
        const shouldStickToBottom = this.shouldStickToBottomOnUpdate();
        this.zone.onStable.pipe(take(1)).subscribe(() => {
          const restoredAnchor = this.restoreLoadMoreAnchorIfNeeded();
          if (this.pendingMessageScroll) {
              const targetId = this.pendingMessageScroll;
              setTimeout(() => {
                this.performScrollToId(targetId);
                // Répète le scroll pour compenser le décalage dû au chargement des images
                setTimeout(() => this.performScrollToId(targetId), 400);
                setTimeout(() => this.performScrollToId(targetId), 1000);
                setTimeout(() => {
                  this.performScrollToId(targetId);
                  this.pendingMessageScroll = null;
                }, 2500);
              }, 500);
            return;
          }
          if (!restoredAnchor && shouldStickToBottom) this.scrollMainToBottom();
        });
      })
    )
    else this.messages = this.afs.collection('PERRINNMessages', ref => ref
      .where('chain', '==', chain)
      .orderBy('chatImageTimestamp', 'desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes => {
      this.UI.loading = false
      this.isLoadMoreDisabled = changes.length < this.messageNumberDisplay;
      this.updateLastReadDivider(changes)
      changes.forEach(c => {
        const row = c.payload.doc.data() as any;
        if (row['lastMessage']) {
          this.chatLastMessageObj = row
          this.chatSubject = row['chatSubject']
          this.eventDescription = row['eventDescription']
          this.eventDateStart = row['eventDateStart']
          this.eventDuration = row['eventDuration'] || this.eventDuration
          this.eventLocation = row['eventLocation'] || this.eventLocation
          if (row['fund']) this.fund = JSON.parse(JSON.stringify(row['fund']));
          this.updateFundAmountUserCurrency();
          this.selectedDateInit();
          this.eventTimeListInit();
        }
      })
      return changes.map(c => ({
        key: c.payload.doc.id,
        payload: c.payload.doc.data()
      }))
    }),
    tap(() => {
      this.zone.onStable.pipe(take(1)).subscribe(() => {
        this.restoreLoadMoreAnchorIfNeeded();
      });
    })
    )
  }

  isMessageNewTimeGroup(messageServerTimestamp: any) {
    let isMessageNewTimeGroup: boolean
    isMessageNewTimeGroup = Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 60 * 4
    return isMessageNewTimeGroup
  }

  isMessageNewUserGroup(user: any, messageServerTimestamp: any) {
    let isMessageNewUserGroup: boolean
    isMessageNewUserGroup = Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 5 || (user != this.previousMessageUser)
    return isMessageNewUserGroup
  }

  storeMessageValues(message: any) {
    this.previousMessageUser = message.user
    this.previousMessageServerTimestamp = message.serverTimestamp || { seconds: this.UI.nowSeconds * 1000 }
  }

  toggleMessageOptions(messageKey: string) {
    this.messageOptionsOpenFor = this.messageOptionsOpenFor === messageKey ? null : messageKey;
  }

  closeMessageOptions() {
    this.messageOptionsOpenFor = null;
  }

  closeMessageActions() {
    this.messageOptionsOpenFor = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.closeMessageActions();
  }

  openMessageJson(message: any) {
    const payload = {
      key: message?.key,
      payload: message?.payload || {}
    };
    try {
      this.selectedMessageJsonFormatted = JSON.stringify(payload, null, 2);
    } catch {
      this.selectedMessageJsonFormatted = '{\n  "error": "Unable to format message JSON"\n}';
    }
    this.showMessageJsonModal = true;
    this.messageOptionsOpenFor = null;
  }

  setAsUnreadFromMessage(message: any) {
    const messageKey = message?.key;
    const payload = message?.payload || {};
    const chain = payload?.chain || this.chatLastMessageObj?.chain || this.chatChain;
    const selectedTimestampMessage = this.toMillis(payload?.serverTimestamp);
    if (!this.UI.currentUser || !messageKey || !chain || !selectedTimestampMessage) {
      this.messageOptionsOpenFor = null;
      return;
    }

    const lastSeenTimestampMessage = Math.max(0, selectedTimestampMessage - 1);

    this.lastSeenServerTimestampMessage = lastSeenTimestampMessage;
    this.lastSeenMessageId = null;

    this.afs.firestore
      .collection('lastSeen')
      .doc(this.UI.currentUser)
      .collection('chats')
      .doc(chain)
      .set({
        messageId: null,
        serverTimestamp: firebase.firestore.Timestamp.fromMillis(lastSeenTimestampMessage),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    this.lastRead = messageKey;
    this.messageOptionsOpenFor = null;
  }

  closeMessageJsonModal() {
    this.showMessageJsonModal = false;
  }

  openCancelEventModal() {
    this.showCancelEventModal = true;
  }

  closeCancelEventModal() {
    this.showCancelEventModal = false;
  }

  confirmCancelEvent() {
    this.showCancelEventModal = false;
    this.cancelEvent();
  }

  openCancelFundModal() {
    this.showCancelFundModal = true;
  }

  closeCancelFundModal() {
    this.showCancelFundModal = false;
  }

  confirmCancelFund() {
    this.showCancelFundModal = false;
    this.fund.daysLeft = 0.1;
    this.fund.amountGBPTarget = 0.0001;
    this.fund.description = 'add a description';
    this.saveFund('cancelling fund');
  }

  scrollMainToBottom() {
    const mc = this.scrollContainer?.nativeElement;
    if (mc) mc.scrollTop = mc.scrollHeight;
  }

  scrollMainToTop() {
    const mc = this.scrollContainer?.nativeElement;
    if (mc) mc.scrollTop = 0;
  }

  scrollToMessage(messageKey: string) {
    this.showImageGallery = false;
    this.pendingMessageScroll = messageKey;
    this.messageNumberDisplay = Math.max(this.messageNumberDisplay, 100);
    this.refreshMessages(this.chatLastMessageObj.chain || this.chatChain);
  }

  private shouldStickToBottomOnUpdate(): boolean {
    const mc = this.scrollContainer?.nativeElement;
    if (!mc) return true;
    const distanceFromBottom = mc.scrollHeight - (mc.scrollTop + mc.clientHeight);
    const isMobileViewport = window.matchMedia('(max-width: 900px)').matches;
    const threshold = isMobileViewport ? 180 : 90;
    return distanceFromBottom <= threshold;
  }

  private captureLoadMoreAnchor(): void {
    const mc = this.scrollContainer?.nativeElement;
    if (!mc) return;
    this.pendingLoadMoreAnchorRestore = true;
    this.loadMoreAnchorTop = mc.scrollTop;
    this.loadMoreAnchorHeight = mc.scrollHeight;
  }

  private restoreLoadMoreAnchorIfNeeded(): boolean {
    if (!this.pendingLoadMoreAnchorRestore) return false;
    this.pendingLoadMoreAnchorRestore = false;
    const mc = this.scrollContainer?.nativeElement;
    if (!mc) return false;
    if (this.showImageGallery) {
      const scrollToBottom = () => { mc.scrollTop = mc.scrollHeight; };
      scrollToBottom();
      // Stabilizes the position while the grid images are loading,
      // with a final adjustment for the slowest-loading images.
      setTimeout(scrollToBottom, 400);
      setTimeout(scrollToBottom, 1000);
      setTimeout(scrollToBottom, 2500); // Added for increased stability
    } else {
      mc.scrollTop = 0;
    }
    return true;
  }

  saveNewSubject() {
    this.UI.createMessage({
      text: 'Changing subject to ' + this.chatSubject,
      chain: this.chatLastMessageObj.chain || this.chatChain,
      chatSubject: this.chatSubject,
    })
    this.resetChat()
  }

  private getTransferAmountValue(): number {
    const value = Number(this.transactionAmount);
    return Number.isFinite(value) ? value : 0;
  }

  private getTransferBalanceValue(): number {
    return Number(this.UI.currentUserLastMessageObj?.wallet?.balance || 0);
  }

  private hasTransactionReference(): boolean {
    return !!(this.transactionReference && String(this.transactionReference).trim().length > 0);
  }

  private hasSelectedTransferRecipient(): boolean {
    if (!this.transactionUser || !this.transactionUserName) return false;
    if (this.transactionUser === this.UI.currentUser) {
      return !!this.transactionCode;
    }
    return true;
  }

  canSendTransactionOut(): boolean {
    const amount = this.getTransferAmountValue();
    const balance = this.getTransferBalanceValue();
    return amount > 0
      && amount <= balance
      && this.hasSelectedTransferRecipient()
      && this.hasTransactionReference();
  }

  canCreatePendingTransaction(): boolean {
    const amount = this.getTransferAmountValue();
    const balance = this.getTransferBalanceValue();
    return amount > 0
      && amount <= balance
      && !this.hasSelectedTransferRecipient()
      && this.hasTransactionReference();
  }

  selectRecipient(recipient: string) {
    const isSelf = recipient === this.UI.currentUser;
    const isAlreadySelected = this.transactionUser === recipient;
    if (isAlreadySelected || (isSelf && !this.transactionCode)) {
      this.transactionUser = null;
      this.transactionUserName = null;
    } else {
      this.transactionUser = recipient;
      this.transactionUserName = this.chatLastMessageObj?.recipients[recipient]?.name;
    }
  }

  onTransactionCodeInput() {
    if (!this.transactionCode && this.transactionUser === this.UI.currentUser) {
      this.transactionUser = null;
      this.transactionUserName = null;
    }
  }

  createTransactionOut(transactionAmount: number | null, transactionCode: string | null, transactionUser: string | null, transactionUserName: string | null, transactionReference: string | null) {
    if (!this.canSendTransactionOut()) return;
    const amount = Number(transactionAmount || 0);
    const cleanReference = String(transactionReference || '').trim();
    this.UI.createMessage({
      text: 'sending ' + ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).symbol||'') + amount + ' to ' + transactionUserName + ((transactionCode || null) ? ' using code ' : '') + ((transactionCode || null) ? transactionCode : '') + ' (Reference: ' + cleanReference + ')',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      transactionOut: {
        user: transactionUser,
        amount: amount * ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0),
        code: transactionCode || null,
        reference: cleanReference || null
      }
    })
    this.resetChat()
  }

  createTransactionPending(transactionAmount: number | null, transactionCode: string | null, transactionUser: string | null, transactionUserName: string | null, transactionReference: string | null) {
    if (!this.canCreatePendingTransaction()) return;
    const amount = Number(transactionAmount || 0);
    const cleanReference = String(transactionReference || '').trim();
    this.UI.createMessage({
      text: 'creating a pending transaction of ' + ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).symbol||'') + amount + ((transactionCode || null) ? ' using code ' : '') + ((transactionCode || null) ? transactionCode : '') + ' (Reference: ' + cleanReference + ')',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      transactionPending: {
        amount: amount * ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0),
        code: transactionCode || null,
        reference: cleanReference || null
      }
    })
    this.resetChat()
  }

  saveEvent() {
    this.eventDateStart = this.selectedTime*1;
    this.eventDescription = this.eventDescriptionChoice;
    this.eventDuration = this.eventDurationChoice*1;
    this.eventLocation = this.eventLocationChoice;
    this.UI.createMessage({
      text: 'new event',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      eventDateStart: this.eventDateStart,
      eventDateEnd: this.eventDateStart + this.eventDuration * 3600000,
      eventDescription: this.eventDescription,
      eventDuration: this.eventDuration,
      eventLocation: this.eventLocation
    })
    this.resetChat()
  }

  cancelEvent() {
    this.UI.createMessage({
      text: 'cancelling event',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      eventDateStart: this.UI.nowSeconds * 1000 - 3600000,
      eventDateEnd: this.UI.nowSeconds * 1000 - 3600000,
      eventLocation: this.googleMeet
    })
    this.resetChat()
  }

  saveFund(text: string = 'edited fund') {
    this.UI.createMessage({
      text: text,
      chain: this.chatLastMessageObj.chain || this.chatChain,
      fund: this.fund
    })
    this.resetChat()
  }

  onFundAmountUserCurrencyInput(event: any) {
    this.fundAmountUserCurrency = this.sanitizeNumberInput(event);
    const currencyList = this.UI.PERRINNAdminLastMessageObj?.currencyList || {};
    const gbpToCoin = (currencyList['gbp'] || {}).toCOIN || 1;
    const userCurrency = this.UI.currentUserLastMessageObj?.userCurrency || 'gbp';
    const userToCoin = (currencyList[userCurrency] || {}).toCOIN || 1;
    this.fund.amountGBPTarget = Math.round(((Number(this.fundAmountUserCurrency) * userToCoin) / gbpToCoin) * 100) / 100;
  }

  private updateFundAmountUserCurrency() {
    if (!this.fund) return;
    const currencyList = this.UI.PERRINNAdminLastMessageObj?.currencyList || {};
    const gbpToCoin = (currencyList['gbp'] || {}).toCOIN || 1;
    const userCurrency = this.UI.currentUserLastMessageObj?.userCurrency || 'gbp';
    const userToCoin = (currencyList[userCurrency] || {}).toCOIN || 1;
    this.fundAmountUserCurrency = Math.round((this.fund.amountGBPTarget * gbpToCoin / userToCoin) * 100) / 100;
  }

  addMessage() {
    this.UI.createMessage({
      text: this.draftMessage,
      chain: this.chatLastMessageObj.chain || this.chatChain,
      chatImageTimestamp: this.imageTimestamp,
      chatImageUrlThumb: this.imageDownloadUrl,
      chatImageUrlMedium: this.imageDownloadUrl,
      chatImageUrlOriginal: this.imageDownloadUrl
    })
    this.resetChat()
  }

  saveChatProfileImage() {
    if (!this.chatProfileImageTimestamp || !this.chatProfileImageDownloadUrl) return;
    this.UI.createMessage({
      text: 'Changing chat profile image',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      chatImageTimestamp: this.chatProfileImageTimestamp,
      chatImageUrlThumb: this.chatProfileImageDownloadUrl,
      chatImageUrlMedium: this.chatProfileImageDownloadUrl,
      chatImageUrlOriginal: this.chatProfileImageDownloadUrl,
      chatProfileImageTimestamp: this.chatProfileImageTimestamp,
      chatProfileImageUrlThumb: this.chatProfileImageDownloadUrl,
      chatProfileImageUrlMedium: this.chatProfileImageDownloadUrl,
      chatProfileImageUrlOriginal: this.chatProfileImageDownloadUrl,
    })
    this.resetChat()
  }

  clearSelectedImage() {
    this.imageTimestamp = null
    this.imageDownloadUrl = null
  }

  onImageChange(event: any) {
    const image = event.target.files[0]
    const uploader = document.getElementById('uploader') as HTMLInputElement
    const storageRef = this.storage.ref('images/' + Date.now() + image.name)
    const task = storageRef.put(image)

    task.snapshotChanges().subscribe((snapshot) => {
      const buttonFile = document.getElementById('buttonFile');
      const uploaderElement = document.getElementById('uploader');
      if (buttonFile) buttonFile.style.visibility = 'hidden'
      if (uploaderElement) uploaderElement.style.visibility = 'visible'

      if (snapshot) {
        const percentage = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        uploader.value = percentage.toString()
      }
    },
      (err: any) => {
        const buttonFile = document.getElementById('buttonFile');
        const uploaderElement = document.getElementById('uploader');
        if (buttonFile) buttonFile.style.visibility = 'visible'
        if (uploaderElement) uploaderElement.style.visibility = 'hidden'
        uploader.value = '0'
      },
      () => {
        uploader.value = '0'
        const buttonFile = document.getElementById('buttonFile');
        const uploaderElement = document.getElementById('uploader');
        if (buttonFile) buttonFile.style.visibility = 'visible'
        if (uploaderElement) uploaderElement.style.visibility = 'hidden'
        this.imageTimestamp = task.task.snapshot.ref.name.substring(0, 13)
        storageRef.getDownloadURL().subscribe(url => {
          this.imageDownloadUrl = url
          event.target.value = ''
        })
      })
  }

  onChatProfileImageChange(event: any) {
    const image = event.target.files[0]
    if (!image) return;
    const storageRef = this.storage.ref('images/' + Date.now() + image.name)
    const task = storageRef.put(image)

    task.snapshotChanges().subscribe(
      () => {},
      () => {
        event.target.value = ''
      },
      () => {
        this.chatProfileImageTimestamp = task.task.snapshot.ref.name.substring(0, 13)
        storageRef.getDownloadURL().subscribe(url => {
          this.chatProfileImageDownloadUrl = url
          event.target.value = ''
        })
      }
    )
  }

  refreshSearchLists() {
    if (this.searchFilter) {
      const searchLower = this.searchFilter.toLowerCase();
      if (this.searchFilter.length > 1) {
        this.teams = this.afs.collection('PERRINNMessages', ref => ref
          .where('userChain.nextMessage', '==', 'none')
          .where('verified', '==', true)
          .where('nameLowerCase', '>=', searchLower)
          .where('nameLowerCase', '<=', searchLower + '\uf8ff')
          .orderBy('nameLowerCase')
          .limit(20))
          .snapshotChanges().pipe(map(changes => {
            return changes.map(c => ({
              key: c.payload.doc.id,
              values: c.payload.doc.data()
            }))
          }))
      }
    } else {
      this.teams = null
    }
  }

  resetChat() {
    this.searchFilter = null
    this.teams = null
    this.draftMessage = ''
    this.imageTimestamp = null
    this.imageDownloadUrl = null
    this.chatProfileImageTimestamp = null
    this.chatProfileImageDownloadUrl = null
    this.transactionAmount = null
    this.transactionCode = null
    this.transactionReference = null
    this.transactionUser = null
    this.transactionUserName = null
    this.fundAmountUserCurrency = null
    this.showChatDetails = false
    this.messageOptionsOpenFor = null
    this.showMessageJsonModal = false
    this.selectedMessageJsonFormatted = ''
    this.showCancelFundModal = false
    this.showCancelEventModal = false
    this.pendingMessageScroll = null

    // wait for view to settle, then resize if textarea exists
    this.zone.onStable.pipe(take(1)).subscribe(() => {
      const el = this.msgBox?.nativeElement;
      if (el) this.autoResize(el);
      if (!this.pendingMessageScroll) this.scrollMainToBottom();
      setTimeout(() => {
        this.updateFixedOffsets();
      }, 180);
      // Recalculate offsets after the CSS transition (approx 400ms) finishes
      setTimeout(() => {
        this.updateFixedOffsets();
        if (!this.pendingMessageScroll) this.scrollMainToBottom();
      }, 450);
    });
  }


  autoResize(el: HTMLTextAreaElement) {
    const mc = this.scrollContainer?.nativeElement;
    const wasAtBottom = mc ? (mc.scrollHeight - mc.scrollTop - mc.clientHeight < 20) : false;

    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';

    if (wasAtBottom && mc) {
      mc.scrollTop = mc.scrollHeight;
      requestAnimationFrame(() => {
        mc.scrollTop = mc.scrollHeight;
      });
    }
    if (window.innerWidth < 900) this.scheduleOffsetsRefresh();
  }

  private performScrollToId(id: string) {
    const mc = this.scrollContainer?.nativeElement;
    const el = document.getElementById(id);
    if (el && mc) {
      const rect = el.getBoundingClientRect();
      const mcRect = mc.getBoundingClientRect();
      mc.scrollTo({
        top: mc.scrollTop + (rect.top - mcRect.top) + (rect.height / 2) - (mc.clientHeight / 2),
        behavior: 'auto'
      });
    }
  }

  validateNumberInput(event: KeyboardEvent, allowDecimal: boolean = true, maxDecimals: number = 2) {
    const input = event.target as HTMLInputElement;
    const value = input.value || '';
    const key = event.key;

    if (/\d/.test(key)) {
      const dotIndex = value.indexOf('.') !== -1 ? value.indexOf('.') : value.indexOf(',');
      if (dotIndex !== -1) {
        if (input.selectionStart !== null && input.selectionStart > dotIndex && input.selectionStart === input.selectionEnd) {
          const decimalPart = value.split(/[.,]/)[1] || '';
          if (decimalPart.length >= (allowDecimal ? maxDecimals : 0)) {
            event.preventDefault();
          }
        }
      }
      return;
    }

    if (key === '.' || key === ',') {
      if (!allowDecimal || value.includes('.') || value.includes(',')) {
        event.preventDefault();
      }
      return;
    }

    if (['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'Home', 'End'].includes(key) ||
        key.startsWith('Arrow') ||
        (event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(key)) {
      return;
    }

    event.preventDefault();
  }

  sanitizeNumberInput(event: any, allowDecimal: boolean = true, maxDecimals: number = 2): any {
    const input = event.target as HTMLInputElement;
    let str = input.value || '';
    if (str === '') return null;

    if (!allowDecimal) {
      // Pour les entiers, on supprime tout ce qui n'est pas un chiffre
      str = str.replace(/\D/g, '');
    } else {
      // Pour les décimaux, on remplace la virgule par un point et on limite les décimales
      str = str.replace(/,/g, '.');
      str = str.replace(/[^\d.]/g, '');
      const parts = str.split('.');
      if (parts.length > 2) str = parts[0] + '.' + parts.slice(1).join('');
      if (parts[1] && parts[1].length > maxDecimals) {
        str = parts[0] + '.' + parts[1].substring(0, maxDecimals);
      }
    }
    if (input.value !== str) {
      input.value = str;
    }
    return str === '' ? null : str;
  }
}
