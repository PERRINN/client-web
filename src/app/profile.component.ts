import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import firebase from 'firebase/compat/app'
import { AgChartOptions } from 'ag-charts-community'

@Component({
  selector:'profile',
  template:`
  <div class='sheet'>
    <div *ngIf="scope=='all'&&UI.PERRINNProfileLastMessageObj?.imageUrlOriginal!=undefined" style="line-height:0px;clear:both">
      <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%">
      <div class="separator" style="width:100%;margin:0px"></div>
    </div>
    <div *ngIf="scope!='all'" style="clear:both;background-color:black">
      <div style="float:left">
        <img [src]="focusUserLastMessageObj?.imageUrlThumbUser" style="display:inline;float:left;margin:7px;object-fit:cover;width:100px;height:100px;cursor:pointer" (click)="UI.showFullScreenImage(focusUserLastMessageObj?.imageUrlOriginal)">
      </div>
      <div style="padding:10px">
        <div style="clear:both">
          <div *ngIf="focusUserLastMessageObj?.user==UI.currentUser" class="material-icons" style="float:right;cursor:pointer" (click)="router.navigate(['settings'])">settings</div>
          <div style="float:left">
            <span style="font-size:18px;line-height:30px">{{focusUserLastMessageObj?.name}} </span>
            <span style="font-size:14px;line-height:30px">{{UI.formatSharesToPRNCurrency(null,focusUserLastMessageObj?.wallet?.balance||0)}}</span>
            <span *ngIf="focusUserLastMessageObj?.publicLink" class="material-icons-outlined" style="font-size:18px;line-height:10px;margin-left:10px;cursor:pointer" (click)="UI.openWindow(focusUserLastMessageObj?.publicLink)">link</span>
            <br>
            <span *ngIf="focusUserLastMessageObj?.locking?.amountCummulate>1" style="font-size:10px">PRN has been locked for {{(focusUserLastMessageObj?.locking?.amountCummulate||0)/(focusUserLastMessageObj?.wallet?.balance||1)|number:'1.0-0'}} days</span>
            <span *ngIf="focusUserLastMessageObj?.locking?.amountCummulate<=1" style="font-size:10px">PRN has been locked for {{(focusUserLastMessageObj?.locking?.amountCummulate||0)/(focusUserLastMessageObj?.wallet?.balance||1)|number:'1.0-0'}} day</span>
            <br>
            <span style="font-size:10px">Earning {{UI.formatSharesToPRNCurrency(null,focusUserLastMessageObj?.wallet?.balance*(math.exp(UI.appSettingsCosts?.interestRateYear/365)-1))}} per day from interest</span>
            <br>
            <span style="font-size:10px">{{focusUserLastMessageObj?.userPresentation}}</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.signed" style="font-size:10px"> Level {{focusUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px">Waiting for contract signature (Level {{focusUserLastMessageObj?.contract?.level|number:'1.1-1'}})</span>
            <div class="buttonBlack" *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed&&UI.currentUser=='QYm5NATKa6MGD87UpNZCTl6IolX2'" style="margin:15px;font-size:10px" (click)=signContract()>Sign contract</div>
            <br>
            <span style="font-size:10px">Created in {{focusUserLastMessageObj?.createdTimestamp|date:'MMMM yyyy'}}</span>
            <br>
            <span *ngIf="focusUserLastMessageObj?.userChain?.index>1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)>1" style="font-size:10px">{{focusUserLastMessageObj?.userChain?.index}} messages, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</span>
            <span *ngIf="focusUserLastMessageObj?.userChain?.index>1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)<=1" style="font-size:10px">{{focusUserLastMessageObj?.userChain?.index}} messages, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} day ago</span>
            <span *ngIf="focusUserLastMessageObj?.userChain?.index<=1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)>1" style="font-size:10px">{{focusUserLastMessageObj?.userChain?.index}} message, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</span>
            <span *ngIf="focusUserLastMessageObj?.userChain?.index<=1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)<=1" style="font-size:10px">{{focusUserLastMessageObj?.userChain?.index}} message, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} day ago</span>
          </div>
        </div>
      </div>
      <div class="buttonBlack" style="float:left;width:74px;margin:5px;font-size:11px" [style.border-color]="mode=='inbox'?'#B0BAC0':'black'" (click)="mode='inbox';refreshMessages()">inbox</div>
      <div class="buttonBlack" style="float:left;width:74px;margin:5px;font-size:11px" [style.border-color]="mode=='history'?'#B0BAC0':'black'" (click)="mode='history';refreshMessages();refreshChart()">history</div>
      <div class="buttonBlack" style="float:left;width:74px;margin:5px;font-size:11px" [style.border-color]="mode=='chain'?'#B0BAC0':'black'" (click)="mode='chain';refreshMessages()">chain</div>
      <div class="buttonBlack" style="float:left;width:74px;margin:5px;font-size:11px" [style.border-color]="mode=='forecast'?'#B0BAC0':'black'" (click)="mode='forecast';refreshMessages()">forecast</div>
      <div class="buttonBlack" *ngIf="UI.currentUser&&UI.currentUser!=focusUserLastMessageObj?.user" (click)="newMessageToUser()" style="clear:both;width:250px;margin:5px;font-size:11px">New message to {{focusUserLastMessageObj?.name}}</div>
      <div class="separator" style="width:100%;margin:0px"></div>
    </div>
    <div *ngIf="scope=='all'">
      <span class="material-icons" style="float:right;margin:10px;cursor:pointer" (click)="UI.openWindow(UI.PERRINNProfileLastMessageObj?.publicLink)">link</span>
      <div class="material-icons" style="float:left;margin:10px;cursor:pointer" (click)="showTags=!showTags">filter_list</div>
      <div *ngIf="UI.tagFilters.length>0" style="float:left;font-size:10px;line-height:15px;padding:10px;cursor:pointer" (click)="UI.tagFilters=[];refreshMessages()">Clear {{UI.tagFilters.length}} filter{{UI.tagFilters.length>1?'s':''}}</div>
      <ul class="listLight" *ngIf="showTags">
        <li class="buttonBlack" *ngFor="let message of tags|async" style="float:left;width:100px;margin:5px;font-size:11px"
          [style.border-color]="UI.tagFilters.includes(message.payload.doc.data()?.tag)?'white':'black'"
          (click)="UI.tagFilters.includes(message.payload.doc.data()?.tag)?UI.tagFilters.splice(UI.tagFilters.indexOf(message.payload.doc.data()?.tag),1):UI.tagFilters.push(message.payload.doc.data()?.tag);refreshMessages()">
          {{message.payload.doc.data()?.tag}}
        </li>
      </ul>
      <div class="separator" style="width:100%;margin:0px"></div>
    </div>
    <div>
      <ul class="listLight">
        <li *ngFor="let message of comingEvents|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div *ngIf="message.payload.doc.data()?.eventDateEnd/60000>UI.nowSeconds/60">
            <span *ngIf="message.payload.doc.data()?.eventLocation" class="buttonBlack" style="float:right;padding:5px;margin:10px;line-height:13px" (click)="UI.openWindow(message.payload.doc.data()?.eventLocation)">Join</span>
            <div style="float:left;min-width:90px;min-height:40px">
              <span class="material-icons-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer">event</span>
            </div>
            <div>
              <div style="float:left;margin-top:10px;width:60%;white-space:nowrap;text-overflow:ellipsis">
                <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer">settings</span>
                <span style="font-size:15px">{{message.payload.doc.data()?.chatSubject}}</span>
              </div>
              <div style="width:80%">
                <div *ngIf="math.floor(message.payload.doc.data()?.eventDateStart/60000-UI.nowSeconds/60)>0" [style.background-color]="(math.floor(message.payload.doc.data()?.eventDateStart/60000-UI.nowSeconds/60)>60*8)?'black':'#38761D'" style="float:left;color:whitesmoke;padding:0 5px 0 5px">in {{UI.formatSecondsToDhm2(message.payload.doc.data()?.eventDateStart/1000-UI.nowSeconds)}}</div>
                <div *ngIf="math.floor(message.payload.doc.data()?.eventDateStart/60000-UI.nowSeconds/60)<=0&&message.payload.doc.data()?.eventDateEnd/60000>UI.nowSeconds/60" style="float:left;background-color:#7BC463;color:whitesmoke;padding:0 5px 0 5px">Now</div>
                <span style="margin:0 5px 0 5px">{{message.payload.doc.data()?.eventDescription}}</span>
                <span style="margin:0 5px 0 0">{{message.payload.doc.data()?.eventDateStart|date:'EEEE d MMM h:mm a'}} ({{message.payload.doc.data()?.eventDuration}}h)</span>
              </div>
            </div>
            <div class="separator"></div>
          </div>
          </div>
        </li>
      </ul>
      <ul class="listLight">
        <li *ngFor="let message of currentFunds|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div *ngIf="message.payload.doc.data()?.fund?.amountGBPTarget>0">
            <div style="float:left;min-width:90px;min-height:40px">
              <span class="material-symbols-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer">crowdsource</span>
            </div>
            <div>
              <div style="float:left;margin-top:10px;width:60%;white-space:nowrap;text-overflow:ellipsis">
                <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer">settings</span>
                <span style="font-size:15px">{{message.payload.doc.data()?.chatSubject}}</span>
              </div>
              <div style="clear:both">
                <div style="float:left;background-color:black;height:20px;width:65px;text-align:center;color:whitesmoke;padding:0 5px 0 5px"></div>
                <div style="float:left;height:20px;background-color:#38761D;margin-left:-65px" [style.width]="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*65+'px'"></div>
                <div style="float:left;background-color:none;width:65px;margin-left:-65px;text-align:center;color:whitesmoke;padding:0 5px 0 5px">{{(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)|percent:'1.0-0'}}</div>
                <div style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.fund?.daysLeft|number:'1.0-0'}} days left</div>
                <div style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.fund?.description}},</div>
                <div style="float:left;margin:0 5px 0 5px">target: {{UI.formatSharesToCurrency(null,message.payload.doc.data()?.fund?.amountGBPTarget*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} /</div>
                <div style="float:left">raised: {{UI.formatSharesToCurrency(null,message.payload.doc.data()?.fund?.amountGBPRaised*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}}</div>
              </div>
            </div>
            </div>
            <div class="separator"></div>
          </div>
        </li>
      </ul>
      <ul class="listLight">
        <li *ngFor="let message of latestImages|async;let first=first;let last=last" style="float:left;width:20%"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <img [src]="message.payload.doc.data()?.chatImageUrlMedium||message.payload.doc.data()?.chatImageUrlThumb||message.payload.doc.data()?.chatImageUrlOriginal" style="float:left;object-fit:contain;width:100%;height:90px">
          </div>
        </li>
        <div class="separator"></div>
      </ul>
      <div *ngIf="scope!='all'&&mode=='history'" style="height:400px;margin:10px"><ag-charts-angular [options]="chartOptions"></ag-charts-angular></div>
      <ul class="listLight">
        <li *ngFor="let message of messages|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div style="float:left;min-width:84px;min-height:40px">
              <img [src]="message.payload.doc.data()?.imageUrlThumbUser" style="float:left;margin:12px 2px 12px 4px;object-fit:cover;height:40px;width:40px">
              <img *ngIf="message.payload.doc.data()?.recipientList[1]" [src]="message.payload.doc.data()?.recipients[message.payload.doc.data()?.recipientList[1]]?.imageUrlThumb" style="float:left;margin:12px 4px 12px 2px;object-fit:cover;height:25px;width:25px">
            </div>
            <div>
              <div style="float:left;margin-top:10px;width:60%;white-space:nowrap;text-overflow:ellipsis">
                <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer">settings</span>
                <span style="font-size:15px">{{message.payload.doc.data()?.chatSubject}}{{message.payload.doc.data()?.recipientList.length>1?' ('+message.payload.doc.data()?.recipientList.length+')':''}}</span>
              </div>
              <div *ngIf="UI.currentUser&&(UI.currentUserLastMessageObj?.createdTimestamp/1000)<message.payload.doc.data()?.serverTimestamp?.seconds" style="float:right;margin:5px 0 0 0;width:35px;height:20px;line-height:20px;font-size:10px;text-align:center"
                (click)="readFlagClick(message.payload.doc.id,(message.payload.doc.data()?.reads||{})[UI.currentUser])"
                [style.background-color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'#131B20':(message.payload.doc.data()?.recipients[UI.currentUser]?.mentionMessages||message.payload.doc.data()?.text.includes(UI.currentUserLastMessageObj?.name))?'#5BBF2F':message.payload.doc.data()?.recipients[UI.currentUser]?'#38761D':'#B0BAC0'"
                [style.color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'#131B20':whitesmoke">
                {{message.payload.doc.data()?.recipients[UI.currentUser]?.unreadMessages}}
              </div>
              <div *ngIf="UI.currentUser&&(UI.currentUserLastMessageObj?.createdTimestamp/1000)>message.payload.doc.data()?.serverTimestamp?.seconds" style="float:right;margin:5px 0 0 0;width:35px;height:20px;line-height:20px;font-size:10px;text-align:center 0 0 3px"
                [style.background-color]="'#B0BAC0'"
                [style.color]="'#B0BAC0'">
                {{message.payload.doc.data()?.recipients[UI.currentUser]?.unreadMessages}}
              </div>
              <div style="float:right;margin-top:10px;color:#999;font-size:11px;margin-right:10px;width:40px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload.doc.data()?.serverTimestamp?.seconds)))}}</div>
              <div style="clear:both;float:left;margin-bottom:10px;width:90%;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
                <span>{{message.payload.doc.data()?.name}}:&nbsp;</span>
                <span *ngIf="message.payload.doc.data()?.imageResized" class="material-icons-outlined" style="font-size:15px;line-height:12px;margin-right:2px">aspect_ratio</span>
                <span>{{message.payload.doc.data()?.text}}</span>
              </div>
            </div>
            <div class="separator"></div>
          </div>
            <table *ngIf="scope!='all'&&(mode=='chain'||mode=='history')">
              <tr *ngIf="first" style="display: flex">
                <th class="th-date">Date</th>
                <th class="th-days">Days</th>
                <th class="th-messages">Messages</th>
                <th class="th-balance">Balance</th>
                <th class="th-change">Change</th>
                <th class="th-purchase">Purchase</th>
                <th class="th-transaction">Transaction</th>
                <th class="th-interest">Interest</th>
                <th class="th-contract">Contract</th>
                <th class="th-message">Message</th>
              </tr>
              <tr class="tableRow" style="user-select:text; display: flex">
                <th class="th-date">{{(message.payload.doc.data()?.verifiedTimestamp?.seconds*1000)|date:'d MMM YYY'}}</th>
                <th class="th-days">{{first?'':(message.payload.doc.data()?.verifiedTimestamp?.seconds-previousTimestamp.seconds)/3600/24|number:'1.2-2'}}</th>
                <th class="th-messages">{{first?'':(message.payload.doc.data()?.userChain?.index-previousIndex)}}</th>
                <th class="th-balance">{{UI.formatSharesToCurrency(null,message.payload.doc.data()?.wallet?.balance)}}</th>
                <th class="th-change">{{first?'':UI.formatSharesToCurrency(null,message.payload.doc.data()?.wallet?.balance-previousBalance)}}</th>
                <th class="th-purchase">{{first?'':UI.formatSharesToCurrency(null,(message.payload.doc.data()?.purchaseCOIN?.amountCummulate||0)-previousPurchaseCOINAmountCummulate)|blankIfZero}}</th>
                <th class="th-transaction">{{first?'':UI.formatSharesToCurrency(null,(message.payload.doc.data()?.transactionIn?.amountCummulate||0)-(message.payload.doc.data()?.transactionOut?.amountCummulate||0)-previousAmountTransactionCummulate)|blankIfZero}}</th>
                <th class="th-interest">{{first?'':UI.formatSharesToCurrency(null,(message.payload.doc.data()?.interest?.amountCummulate||0)-previousAmountInterestCummulate)|blankIfZero}}</th>
                <th class="th-contract">{{first?'':UI.formatSharesToCurrency(null,(message.payload.doc.data()?.contract?.amountCummulate||0)-previousContractAmountCummulate)|blankIfZero}}</th>
                <th class="th-message">{{message.payload.doc.data()?.userChain?.currentMessage}}</th>
              </tr>
              {{storeMessageValues(message.payload.doc.data())}}
            </table>
        </li>
      </ul>
      <div *ngIf="scope!='all'&&mode=='forecast'">
        <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">Year</div>
        <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">Growth</div>
        <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">Balance</div>
        <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">Multiple</div>
        <div class="tableRow" style="clear:both">
          <ul>
            <li *ngFor="let number of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]" style="clear:both">
              <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">{{number}}</div>
              <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">{{UI.appSettingsCosts?.interestRateYear | percent : "0.0"}}</div>
              <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">
                {{UI.formatSharesToCurrency(null,focusUserLastMessageObj?.wallet?.balance*math.exp(UI.appSettingsCosts?.interestRateYear*number))}}
              </div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;font-size:10px">{{math.exp(UI.appSettingsCosts?.interestRateYear*number)|number:'1.1-1'}}x</div>
            </li>
          </ul>
        </div>
      </div>
      <div class="spinner" *ngIf="UI.loading">
        <div class="bounce1"></div>
        <div class="bounce2"></div>
        <div class="bounce3"></div>
      </div>
      <div class="buttonWhite" *ngIf="!UI.loading&&mode!='history'&&mode!='forecast'" style="width:200px;margin:10px auto" (click)="loadMore()">Load more</div>
      <div class="separator"></div>
    </div>
  </div>
  `,
})
export class ProfileComponent {
  messages:Observable<any[]>
  comingEvents:Observable<any[]>
  currentFunds:Observable<any[]>
  latestImages:Observable<any[]>
  tags:Observable<any[]>
  scrollTeam:string
  focusUserLastMessageObj:any
  scope:string
  mode:string
  previousBalance:string
  previousTimestamp:string
  previousIndex:string
  previousPurchaseCOINAmountCummulate:number
  previousContractAmountCummulate:number
  previousAmountInterestCummulate:number
  previousAmountTransactionCummulate:number
  math:any
  messageNumberDisplay:number
  showTags:boolean
  chartOptions:AgChartOptions

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute
  ) {
    this.showTags=false
    this.math=Math
    this.messageNumberDisplay=30
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
    this.route.params.subscribe(params => {
      this.scope=params.id
      afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc').limit(1)
      ).valueChanges().subscribe(snapshot=>{
        this.focusUserLastMessageObj=snapshot[0]
      })
      this.tags=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('lastMessage','==',true)
        .where('tagLastMessage','==',true)
        .where('verified','==',true)
        .orderBy('tag','asc')
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.refreshMessages()
    })
  }

  ngOnInit() {
  }

  refreshMessages(){
    this.UI.loading=true
    if(this.scope=='all'){
      if(this.UI.tagFilters.length==0){
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
          return changes.map(c=>({payload:c.payload}))
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('verified','==',true)
          .orderBy('chatImageTimestamp','desc')
          .limit(5)
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
        }))
      }
      else{
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('eventDateEnd')
          .where('eventDateEnd','>',this.UI.nowSeconds*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentFunds=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .where('fund.active','==',true)
          .orderBy('fund.daysLeft','asc')
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('verified','==',true)
          .where('tag','in',this.UI.tagFilters)
          .orderBy('chatImageTimestamp','desc')
          .limit(5)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('serverTimestamp','desc')
          .limit(this.messageNumberDisplay)
        ).snapshotChanges().pipe(map(changes=>{
          this.UI.loading=false
          return changes.map(c=>({payload:c.payload}))
        }))
      }
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
      }))
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
        return changes.map(c=>({payload:c.payload}))
      }))
      this.latestImages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope])
        .where('verified','==',true)
        .orderBy('chatImageTimestamp','desc')
        .limit(5)
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
      }))
    }
  }

  refreshChart(){
    this.messages.subscribe(messages => {
      let newData = messages.map((message,index)=>(
        {timestamp:message.payload.doc.data().verifiedTimestamp.seconds*1000,
          balance:this.UI.convertSharesToCurrency(null,(message.payload.doc.data().wallet||{}).balance||0),
          purchase:this.UI.convertSharesToCurrency(null,((message.payload.doc.data().purchaseCOIN||{}).amountCummulate||0)),
          transaction:this.UI.convertSharesToCurrency(null,((message.payload.doc.data().transactionIn||{}).amountCummulate||0)-((message.payload.doc.data().transactionOut||{}).amountCummulate||0)),
          interest:this.UI.convertSharesToCurrency(null,((message.payload.doc.data().interest||{}).amountCummulate||0)),
          contract:this.UI.convertSharesToCurrency(null,((message.payload.doc.data().contract||{}).amountCummulate||0))
        }
      ));
      this.chartOptions = { ...this.chartOptions, data: newData };
    });
  }

  readFlagClick(messageId,readFlag){
    event.stopPropagation()
    if(readFlag)return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).delete()
    return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).set({
      serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()
    })
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

  storeMessageValues(message) {
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

  loadMore() {
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }

}
