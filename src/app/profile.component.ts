import { Component, EventEmitter, Input, Output, NgZone, ChangeDetectorRef, DoCheck, OnInit, OnDestroy, EnvironmentInjector, runInInjectionContext } from '@angular/core'
import { Subscription } from 'rxjs'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map, filter, tap, take } from 'rxjs/operators'
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import { AgChartOptions, AgChartTheme } from 'ag-charts-community'
import { PresenceService } from './presence.service'
import { formatLastSeen } from './lastSeen'
import { MessageActivityService } from './messageActivity.service'
import { ReadCursorService, ReadCursorSession } from './readCursor.service'
import { activeChatChain, sidebarChatCommands } from './chatNavigation';
import { SidebarConversationsService } from './sidebarConversations.service'

@Component({
    selector: 'profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.css'],
    host: { '[class.sidebar-profile]': '!!sidePanelScope' },
    standalone: false
})
export class ProfileComponent implements OnInit, OnDestroy, DoCheck {
  @Input() sidePanelScope?: string;
  @Output() chatOpened = new EventEmitter<void>();
  messages!: Observable<any[]>
  comingEvents!: Observable<any[]>
  currentFunds!: Observable<any[]>
  latestImages!: Observable<any[]>
  scrollTeam!: string
  focusUserLastMessageObj: any = null
  lastSeenByChain: Record<string, number> = {}
  lastSeenSubscription: Subscription | null = null;
  focusUserActivitySubscription: Subscription | null = null;
  authSubscription: Subscription | null = null;
  routeSubscription: Subscription | null = null;
  currentUserId: string | null = null;
  focusUserLastActiveAt = 0
  loadingUserActivity = false
  userActivityError = false
  private scopeSubscription?: Subscription;
  scope!: string
  mode!: string
  previousBalance: any = 0
  previousTimestamp: any = { seconds: 0 }
  activeChatId: string | null = null;
  blueFlagByChain: Record<string, boolean> = {}
  previousIndex: any = 0
  previousPurchaseCOINAmountCummulate = 0
  previousContractAmountCummulate = 0
  previousAmountInterestCummulate = 0
  previousAmountTransactionCummulate = 0
  math: any = Math
  messageNumberDisplay = 0
  showAllEvents = false
  chartOptions!: AgChartOptions
  forecastChartOptions!: AgChartOptions
  private pendingLoadMoreScroll = false;
  private loadedConversations: any[] = [];
  cursorsReady = false;
  private cursorUnavailable = false;
  private conversationsReady = false;
  private conversationsUnavailable = false;
  private cursorSession: ReadCursorSession;

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private cd: ChangeDetectorRef,
    private zone: NgZone,
    private injector: EnvironmentInjector,
    private presence: PresenceService,
    private activity: MessageActivityService,
    private sidebarConversations: SidebarConversationsService,
    cursors: ReadCursorService
  ) {
    this.math=Math
    this.lastSeenByChain={}
    this.cursorSession = cursors.createSession();
    this.lastSeenSubscription = this.cursorSession.changes.subscribe(state => {
      this.lastSeenByChain = state.timestamps;
      this.blueFlagByChain = state.flags;
      this.cursorsReady = state.ready;
      this.cursorUnavailable = state.unavailable;
      this.zone.run(() => this.cd.markForCheck());
    });
    this.focusUserActivitySubscription = null;
    this.authSubscription = null;
    this.currentUserId = null;
    this.focusUserLastActiveAt=0
    this.authSubscription = this.afAuth.authState.subscribe(user => {
      this.currentUserId = user?.uid || null;
      this.subscribeToLastSeen();
    });
    this.messageNumberDisplay=30
    this.showAllEvents=false
    this.scope=''
    this.mode='inbox'
    this.scrollTeam=''
    const palette = getComputedStyle(document.documentElement);
    const paletteAccent = palette.getPropertyValue('--color-accent').trim();
    const paletteSurface = palette.getPropertyValue('--color-surface').trim();
    // Canvas text does not inherit CSS, so use the same family as the document.
    const fontFamily = getComputedStyle(document.documentElement).fontFamily;
    const chartTheme: AgChartTheme = {
      baseTheme: 'ag-default-dark',
      overrides: { common: {
        title: { fontFamily },
        legend: { item: { label: { fontFamily } } },
        axes: {
          number: { label: { fontFamily }, title: { fontFamily } },
          time: { label: { fontFamily }, title: { fontFamily } }
        }
      } }
    };
    this.chartOptions = {
          series: [
            { type: 'line', xKey: 'timestamp', yKey: 'balance', yName: 'PRN balance', marker: { size: 0 }},
            { type: 'line', xKey: 'timestamp', yKey: 'purchase', yName: 'Funding credits', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'transaction', yName: 'Transfers', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'interest', yName: 'Balance adjustments', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'contract', yName: 'Time credits', marker: { size: 0 } }
          ],
          theme: chartTheme,
          background: { fill: paletteSurface },
          axes: [
            {type: 'time', position: 'bottom' },
            {
              type: 'number',
              position: 'left',
              min: 0,
              keys: ['balance','purchase','transaction','interest','contract'],
              label: {
                formatter: (params) => {
                  const value = params.value;
                  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'; // 1M+
                  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K'; // 1K+
                  return value.toString(); // Keep as-is if < 1000
                }
              }
            }
          ],
      }
    this.forecastChartOptions = {
          series: [
            { type: 'line', xKey: 'year', yKey: 'balance', yName: 'PRN balance', marker: { size: 0 }, stroke: paletteAccent, strokeWidth: 2 }
          ],
          theme: chartTheme,
          background: { fill: paletteSurface },
          axes: [
            {type: 'number', position: 'bottom', title: {text: 'Year'} },
            {
              type: 'number',
              position: 'left',
              label: {
                formatter: (params) => {
                  const value = params.value;
                  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
                  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
                  return value.toString();
                }
              }
            }
          ],
      }
  }

  ngOnInit() {
    this.routeSubscription = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateActiveChatState();
    });
    this.updateActiveChatState();

    this.scopeSubscription = this.route.params.subscribe(params => {
      const targetScope = this.sidePanelScope || params.id;
      if (this.scope === targetScope) {
        this.cd.detectChanges();
        return;
      }
      this.scope = targetScope;
      this.loadedConversations = [];
      this.subscribeToLastSeen();
      if (this.scope === 'all') this.mode = 'inbox';
      if (!this.sidePanelScope) this.forceScrollTop();
      runInInjectionContext(this.injector, () => {
        this.afs.collection<any>('PERRINNMessages', ref => ref
          .where('user', '==', this.scope)
          .where('verified', '==', true)
          .orderBy('serverTimestamp', 'desc')
          .limit(1)
        ).valueChanges().subscribe(snapshot => {
          this.focusUserLastMessageObj = snapshot[0]
          if (this.mode == 'forecast') this.refreshForecastChart()
        })
      })
      this.subscribeToFocusUserActivity();
      this.refreshMessages()
      this.subscribeToLastSeen();
    })
    this.forceScrollTop();
    setTimeout(() => {
      this.forceScrollTop();
      this.cd.detectChanges()
    }, 10)
  }

  private updateActiveChatState() {
    this.activeChatId = activeChatChain(this.router.url);
    this.cd.detectChanges();
  }

  private forceScrollTop() {
    if (this.sidePanelScope) {
      const sidebar = document.querySelector('.sideProfile');
      if (sidebar) sidebar.scrollTop = 0;
      return;
    }
    const mainContainer = document.getElementById('main_container');
    if (mainContainer) {
      mainContainer.scrollTop = 0;
      mainContainer.scrollTo({ top: 0, behavior: 'auto' });
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  refreshMessages(){
    return runInInjectionContext(this.injector, () => {
      if (this.scope !== 'all' && ['history', 'chain', 'forecast'].includes(this.mode)) {
        this.loadedConversations = [];
        this.subscribeToLastSeen();
      }
      this.UI.loading=true
      if(this.scope=='all'){
        this.conversationsReady = false;
        this.conversationsUnavailable = false;
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('eventDateEnd')
          .where('eventDateEnd','>',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .where('fund.active','==',true)
          .orderBy('fund.daysLeft','asc')
        ).snapshotChanges().pipe(map(changes=>{
          return changes
            .map(c=>({payload:c.payload}))
            .filter(m => (m.payload.doc.data()?.fund?.amountGBPTarget || 0) >= 0.01)
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('verified','==',true)
          .orderBy('chatImageTimestamp','desc')
          .limit(50)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.messages=(this.sidePanelScope === 'all' ? this.sidebarConversations.human(this.messageNumberDisplay) : this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges()).pipe(map(changes=>{
          this.UI.loading=false
          this.setLoadedConversations(changes);
          return changes.map(c=>({payload:c.payload}))
        }),
        tap({ error: () => {
          this.conversationsUnavailable = true;
          this.zone.run(() => this.cd.markForCheck());
        } }),
        tap(() => this.scrollToBottomOnLoadMore())
        )
      }
      else if(this.mode=='forecast'){
        this.UI.loading=false
      }
      else if(this.mode=='history'){
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('user','==',this.scope)
          .where('verified','==',true)
          .where('userChain.newMonth','==',true)
          .orderBy('serverTimestamp','desc')
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          return changes.reverse().map(c=>({payload:c.payload}))
        }))
      }
      else if(this.mode=='chain'){
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('user','==',this.scope)
          .where('verified','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          return changes.reverse().map(c=>({payload:c.payload}))
        }),
        tap(() => this.scrollToBottomOnLoadMore())
        )
      }
      else{
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('recipientList','array-contains-any',[this.scope])
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('eventDateEnd')
          .where('eventDateEnd','>',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('recipientList','array-contains-any',[this.scope])
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .where('fund.active','==',true)
          .orderBy('fund.daysLeft','asc')
        ).snapshotChanges().pipe(map(changes=>{
          return changes
            .map(c=>({payload:c.payload}))
            .filter(m => (m.payload.doc.data()?.fund?.amountGBPTarget || 0) >= 0.01)
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('recipientList','array-contains-any',[this.scope])
          .where('verified','==',true)
          .orderBy('chatImageTimestamp','desc')
          .limit(50)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('recipientList','array-contains-any',[this.scope])
          .where('verified','==',true)
          .where('lastMessage','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          this.setLoadedConversations(changes);
          return changes.map(c=>({payload:c.payload}))
        }),
        tap(() => this.scrollToBottomOnLoadMore())
        )
      }
    });
  }

  private lastSeenUnsubscribe() {
    if (this.lastSeenSubscription) {
      this.lastSeenSubscription.unsubscribe();
      this.lastSeenSubscription = null;
    }
  }

  private setLoadedConversations(changes: any[]) {
    this.loadedConversations = changes.map(row => row.payload.doc.data());
    this.conversationsReady = true;
    this.conversationsUnavailable = false;
    this.subscribeToLastSeen();
  }

  private subscribeToLastSeen() {
    this.cursorSession.update(this.currentUserId, this.loadedConversations.map(message => message.chain));
  }

  private focusUserActivityUnsubscribe() {
    if (this.focusUserActivitySubscription) {
      this.focusUserActivitySubscription.unsubscribe();
      this.focusUserActivitySubscription = null;
    }
  }

  private subscribeToFocusUserActivity() {
    this.focusUserActivityUnsubscribe();
    this.focusUserLastActiveAt = 0;
    if (!this.scope || this.scope === 'all') return;

    this.loadingUserActivity = true;
    this.userActivityError = false;
    this.focusUserActivitySubscription = this.presence.lastActiveAt(this.scope).subscribe({
      next: timestamp => {
        this.focusUserLastActiveAt = timestamp;
        this.loadingUserActivity = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.userActivityError = true;
        this.loadingUserActivity = false;
        this.cd.markForCheck();
      }
    });
  }

  ngDoCheck() {
    if (this.sidePanelScope !== 'all') return;
    this.activity.updateConversations({
      conversations: this.loadedConversations,
      userId: this.UI.currentUser || null,
      profile: this.UI.currentUserLastMessageObj?.user === this.UI.currentUser ? this.UI.currentUserLastMessageObj : null,
      timestamps: this.lastSeenByChain,
      flags: this.blueFlagByChain,
      ready: this.conversationsReady && this.cursorsReady && this.currentUserId === this.UI.currentUser,
      unavailable: this.cursorUnavailable || this.conversationsUnavailable
    });
  }

  ngOnDestroy() {
    if (this.sidePanelScope === 'all') this.activity.clear();
    this.lastSeenUnsubscribe();
    this.cursorSession.destroy();
    this.focusUserActivityUnsubscribe();
    this.scopeSubscription?.unsubscribe();
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
      this.authSubscription = null;
    }
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
      this.routeSubscription = null;
    }
  }

  private toMillis(value:any):number{
    if(!value)return 0
    if(typeof value==='number')return value
    if(typeof value.seconds==='number')return value.seconds*1000
    if(typeof value.toMillis==='function')return value.toMillis()
    if(typeof value.toDate==='function')return value.toDate().getTime()
    return 0
  }

  isMessageSeen(chain:string,messageTimestamp:any):boolean{
    const lastSeenTimestampMessage=this.lastSeenByChain[chain]||0
    const messageTimestampMessage=this.toMillis(messageTimestamp)
    return !!lastSeenTimestampMessage&&messageTimestampMessage>0&&messageTimestampMessage<=lastSeenTimestampMessage
  }

  formatFocusUserActivity():string{
    if(this.loadingUserActivity)return 'Loading'
    if(this.userActivityError)return 'Activity unavailable'
    return formatLastSeen(this.focusUserLastActiveAt)
  }

  scrollMainToBottom() {
    const mc = document.getElementById('main_container');
    if (mc && !this.sidePanelScope) mc.scrollTop = mc.scrollHeight;
    const sp = document.querySelector('.sideProfile');
    if (sp) sp.scrollTop = sp.scrollHeight;
  }

  private scrollToBottomOnLoadMore() {
    if (this.pendingLoadMoreScroll) {
      this.zone.onStable.pipe(take(1)).subscribe(() => {
        const scrollToBottom = () => this.scrollMainToBottom();
        scrollToBottom();
        setTimeout(scrollToBottom, 400);
        setTimeout(scrollToBottom, 1000);
        setTimeout(scrollToBottom, 2500);
        this.pendingLoadMoreScroll = false;
      });
    }
  }

  refreshChart(){
    this.messages.subscribe(messages => {
      const newData = messages.map((message,index)=>(
        {timestamp:message.payload.doc.data().verifiedTimestamp.seconds*1000,
          balance:this.UI.convertPRNToCurrency(null,(message.payload.doc.data().wallet||{}).balance||0),
          purchase:this.UI.convertPRNToCurrency(null,((message.payload.doc.data().purchaseCOIN||{}).amountCummulate||0)),
          transaction:this.UI.convertPRNToCurrency(null,((message.payload.doc.data().transactionIn||{}).amountCummulate||0)-((message.payload.doc.data().transactionOut||{}).amountCummulate||0)),
          interest:this.UI.convertPRNToCurrency(null,((message.payload.doc.data().interest||{}).amountCummulate||0)),
          contract:this.UI.convertPRNToCurrency(null,((message.payload.doc.data().contract||{}).amountCummulate||0))
        }
      ));
      this.chartOptions = { ...this.chartOptions, data: newData };
    });
  }

  refreshForecastChart(){
    const rateYear = this.UI.PERRINNAdminLastMessageObj?.interest?.rateYear || 0;
    const balance = this.focusUserLastMessageObj?.wallet?.balance || 0;
    const newData = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(number => ({
      year: number,
      balance: this.UI.convertPRNToCurrency(null, balance * this.math.exp(rateYear * number))
    }));
    this.forecastChartOptions = { ...this.forecastChartOptions, data: newData };
  }

  newMessageToUser() {
    const ID=this.UI.newId()
    this.UI.createMessage({
      text:'Starting a new chat.',
      chain:ID,
      recipientList:[this.focusUserLastMessageObj.user]
    })
    this.router.navigate(['chat',ID])
  }

  storeMessageValues(message: any) {
    this.previousBalance=((message.wallet||{}).balance)||0
    this.previousTimestamp=message.verifiedTimestamp
    this.previousIndex=message.userChain.index
    this.previousPurchaseCOINAmountCummulate=(message.purchaseCOIN||{}).amountCummulate||0
    this.previousContractAmountCummulate=(message.contract||{}).amountCummulate||0
    this.previousAmountInterestCummulate=(message.interest||{}).amountCummulate||0
    this.previousAmountTransactionCummulate=((message.transactionIn||{}).amountCummulate||0)-((message.transactionOut||{}).amountCummulate||0)
  }

  signContract(){
    this.UI.createMessage({
      chain:this.focusUserLastMessageObj.user,
      text:'Contract signature for level '+((this.focusUserLastMessageObj.contract||{}).level||0),
      contractSignature:{
        user:this.focusUserLastMessageObj.user,
        contract:this.focusUserLastMessageObj.contract||{}
      }
    })
    this.router.navigate(['chat',this.focusUserLastMessageObj.user])
  }

  openListedChat(chain: string, messageKey?: string) {
    if (!chain) return;
    const commands = this.sidePanelScope ? sidebarChatCommands(chain) : ['/chat', chain];
    if (this.sidePanelScope) this.chatOpened.emit();
    if (messageKey) {
      this.router.navigate(commands, { queryParams: { scroll: messageKey } });
    } else {
      this.router.navigate(commands);
    }
  }

  isEventLive(eventDateStart: any, eventDateEnd: any): boolean {
    const start = Number(eventDateStart || 0)
    const end = Number(eventDateEnd || 0)
    const now = this.UI.nowSeconds * 1000
    return (start - 300000) <= now && end > now
  }

  openCarouselImage(message: { chatSubject?: string; chain?: string; chatImageUrlOriginal?: string; chatImageUrlMedium?: string; chatImageUrlThumb?: string }, id: string) {
    const src = message.chatImageUrlOriginal || message.chatImageUrlMedium || message.chatImageUrlThumb;
    if (src) this.UI.showFullScreenImage(src, { chain: message.chain, id, name: 'Shared image', subject: message.chatSubject });
  }

  loadMore() {
    this.pendingLoadMoreScroll = true;
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }


}
