import { Component, Input, NgZone, HostListener } from '@angular/core'
import { Subscription } from 'rxjs'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map, filter, tap, take } from 'rxjs/operators'
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router'
import { UserInterfaceService } from '../userInterface.service'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import firebase from 'firebase/compat/app'
import { AgChartOptions } from 'ag-charts-community'
import { ChangeDetectorRef } from '@angular/core'

@Component({
  selector: 'profile',
  templateUrl: 'profile.component.html'
})
export class ProfileComponent {
  @Input() sidePanelScope?: string;
  messages!: Observable<any[]>
  comingEvents!: Observable<any[]>
  currentFunds!: Observable<any[]>
  latestImages!: Observable<any[]>
  scrollTeam!: string
  focusUserLastMessageObj: any = null
  lastSeenByChain: Record<string, number> = {}
  lastSeenSubscription: Subscription | null = null;
  focusUserLastSeenSubscription: Subscription | null = null;
  authSubscription: Subscription | null = null;
  routeSubscription: Subscription | null = null;
  currentUserId: string | null = null;
  focusUserLastSeenTimestampMessage = 0
  scope!: string
  mode!: string
  previousBalance: any = 0
  previousTimestamp: any = { seconds: 0 }
  activeChatId: string | null = null;
  blueFlagByChain: Record<string, boolean> = {}
  messageOptionsOpenFor: string | null = null
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

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private cd: ChangeDetectorRef,
    private zone: NgZone
  ) {
    this.math=Math
    this.lastSeenByChain={}
    this.lastSeenSubscription = null;
    this.focusUserLastSeenSubscription = null;
    this.authSubscription = null;
    this.currentUserId = null;
    this.focusUserLastSeenTimestampMessage=0
    this.authSubscription = this.afAuth.authState.subscribe(user => {
      this.currentUserId = user?.uid || this.UI.currentUser || null;
      this.subscribeToLastSeen();
    });
    this.messageNumberDisplay=30
    this.showAllEvents=false
    this.scope=''
    this.mode='inbox'
    this.scrollTeam=''
    this.chartOptions = {
          series: [
            { type: 'line', xKey: 'timestamp', yKey: 'balance', marker: { size: 0 }},
            { type: 'line', xKey: 'timestamp', yKey: 'purchase', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'transaction', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'interest', marker: { size: 0 } },
            { type: 'line', xKey: 'timestamp', yKey: 'contract', marker: { size: 0 } }
          ],
          theme: 'ag-default-dark',
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
            { type: 'line', xKey: 'year', yKey: 'balance', marker: { size: 0 }, stroke: '#10b981', strokeWidth: 2 }
          ],
          theme: 'ag-default-dark',
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

    this.route.params.subscribe(params => {
      const targetScope = this.sidePanelScope || params.id;
      if (this.scope === targetScope) {
        this.cd.detectChanges();
        return;
      }
      this.scope = targetScope;
      if (this.scope === 'all') this.mode = 'inbox';
      if (!this.sidePanelScope) this.forceScrollTop();
      this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc').limit(1)
      ).valueChanges().subscribe(snapshot=>{
        this.focusUserLastMessageObj=snapshot[0]
        if(this.mode=='forecast') this.refreshForecastChart()
      })
      this.subscribeToFocusUserLastSeen();
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
    const url = this.router.url;
    if (url.startsWith('/chat/')) {
      this.activeChatId = url.split('/')[2].split('?')[0];
    } else {
      this.activeChatId = null;
    }
    this.cd.detectChanges();
  }

  private forceScrollTop() {
    const mainContainer = document.getElementById('main_container');
    if (mainContainer) {
      mainContainer.scrollTop = 0;
      mainContainer.scrollTo({ top: 0, behavior: 'auto' });
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async refreshMessages(){
    // lastSeenByChain is now updated in real-time
    this.UI.loading=true
    if(this.scope=='all'){
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
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        this.UI.loading=false
        return changes.map(c=>({payload:c.payload}))
      }),
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
        return changes.map(c=>({payload:c.payload}))
      }),
      tap(() => this.scrollToBottomOnLoadMore())
      )
    }
  }

  private lastSeenUnsubscribe() {
    if (this.lastSeenSubscription) {
      this.lastSeenSubscription.unsubscribe();
      this.lastSeenSubscription = null;
    }
  }

  private subscribeToLastSeen() {
    this.lastSeenUnsubscribe();
    const userId = this.UI.currentUser || this.currentUserId;
    if (!userId) {
      this.lastSeenByChain = {};
      return;
    }
    this.lastSeenSubscription = this.afs.collection<any>(`lastSeen/${userId}/chats`).snapshotChanges().subscribe(snaps => {
      const mapByChain: Record<string, number> = {};
      const blueFlagMap: Record<string, boolean> = {};
      snaps.forEach(snap => {
        const data = snap.payload.doc.data() || {};
        const timestampMessage = this.toMillis(data['serverTimestamp']);
        if (timestampMessage > 0) mapByChain[snap.payload.doc.id] = timestampMessage;
        blueFlagMap[snap.payload.doc.id] = !!data['blueFlag'];
      });
      this.lastSeenByChain = mapByChain;
      this.blueFlagByChain = blueFlagMap;
      this.cd.detectChanges();
    });
  }

  private focusUserLastSeenUnsubscribe() {
    if (this.focusUserLastSeenSubscription) {
      this.focusUserLastSeenSubscription.unsubscribe();
      this.focusUserLastSeenSubscription = null;
    }
  }

  private subscribeToFocusUserLastSeen() {
    this.focusUserLastSeenUnsubscribe();
    this.focusUserLastSeenTimestampMessage = 0;
    if (!this.scope || this.scope === 'all') return;
    this.focusUserLastSeenSubscription = this.afs.collection<any>(`lastSeen/${this.scope}/chats`, ref => ref
      .orderBy('updatedAt', 'desc')
      .limit(1)
    ).snapshotChanges().subscribe(snaps => {
      const latest = snaps[0]?.payload?.doc?.data() || {};
      this.focusUserLastSeenTimestampMessage = this.toMillis(latest['updatedAt']) || this.toMillis(latest['serverTimestamp']);
      this.cd.detectChanges();
    });
  }

  ngOnDestroy() {
    this.lastSeenUnsubscribe();
    this.focusUserLastSeenUnsubscribe();
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

  formatFocusUserLastSeen():string{
    if(!this.focusUserLastSeenTimestampMessage)return '--'
    return this.UI.formatSecondsToDhm1(this.math.max(0,this.UI.nowSeconds-this.focusUserLastSeenTimestampMessage/1000))+' ago'
  }

  scrollMainToBottom() {
    const mc = document.getElementById('main_container');
    if (mc) mc.scrollTop = mc.scrollHeight;
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
      let newData = messages.map((message,index)=>(
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
    let ID=this.UI.newId()
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
    // readFlagClick removed: lastSeen is now updated only on reload/refresh
    if (messageKey) {
      this.router.navigate(['chat', chain], { queryParams: { scroll: messageKey } });
    } else {
      this.router.navigate(['chat', chain]);
    }
  }

  isEventLive(eventDateStart: any, eventDateEnd: any): boolean {
    const start = Number(eventDateStart || 0)
    const end = Number(eventDateEnd || 0)
    const now = this.UI.nowSeconds * 1000
    return (start - 300000) <= now && end > now
  }

  openCarouselImage(imageUrl: string) {
    if (!imageUrl) return
    this.UI.showFullScreenImage(imageUrl)
  }

  loadMore() {
    this.pendingLoadMoreScroll = true;
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }

  toggleBlueFlag(chain: string) {
    const userId = this.UI.currentUser || this.currentUserId;
    if (!userId || !chain) return;
    const currentStatus = !!this.blueFlagByChain[chain];
    this.afs.collection(`lastSeen/${userId}/chats`).doc(chain).set({
      blueFlag: !currentStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    this.messageOptionsOpenFor = null;
  }

  @HostListener('document:click')
  onDocumentClick() {
    this.messageOptionsOpenFor = null;
  }

}
