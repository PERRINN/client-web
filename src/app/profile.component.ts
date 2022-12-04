import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import * as firebase from 'firebase/app'

@Component({
  selector:'profile',
  template:`
  <div class='sheet'>
    <div *ngIf="scope=='all'&&UI.PERRINNProfileLastMessageObj?.imageUrlOriginal!=undefined" style="clear:both">
      <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%">
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div *ngIf="scope!='all'" style="clear:both;background:whitesmoke">
      <div style="float:left">
        <img [src]="focusUserLastMessageObj?.imageUrlThumbUser" style="display:inline;float:left;margin:7px;object-fit:cover;width:75px;height:75px;border-radius:50%">
      </div>
      <div style="padding:10px">
        <div style="clear:both">
          <div style="float:left;width:200px">
            <span style="font-size:18px;line-height:30px">{{focusUserLastMessageObj?.name}} </span>
            <span style="font-size:18px;line-height:30px">{{UI.formatCOINS(focusUserLastMessageObj?.wallet?.shareBalance||0)}}</span>
            <br>
            <span style="font-size:10px">{{focusUserLastMessageObj?.userPresentation}}</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.signed" style="font-size:10px"> {{focusUserLastMessageObj?.contract?.position}} Level {{focusUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px;color:black">Waiting for contract signature ({{focusUserLastMessageObj?.contract?.position}} Level {{focusUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}})</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed&&UI.currentUser=='QYm5NATKa6MGD87UpNZCTl6IolX2'" style="margin:15px;font-size:10px;color:black;cursor:pointer" (click)=signContract()>Sign contract</span>
          </div>
          <div *ngIf="focusUserLastMessageObj?.user==UI.currentUser" class="material-icons" style="float:right;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="router.navigate(['settings'])">settings</div>
        </div>
        <div style="clear:both;float:left;font-size:10px;color:#999">Created {{focusUserLastMessageObj?.createdTimestamp|date:'MMMM yyyy'}}, {{focusUserLastMessageObj?.userChain?.index}} Messages, Verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</div>
        <div style="clear:both">
          <div style="float:left;font-size:10px;color:black;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='inbox'?'underline':'none'" (click)="mode='inbox';refreshMessages()">inbox</div>
          <div style="float:left;font-size:10px;color:black;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='30days'?'underline':'none'" (click)="mode='30days';refreshMessages()">30 days</div>
          <div style="float:left;font-size:10px;color:black;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='24months'?'underline':'none'" (click)="mode='24months';refreshMessages()">24 months</div>
          <div style="float:left;font-size:10px;color:black;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='chain'?'underline':'none'" (click)="mode='chain';refreshMessages()">chain</div>
        </div>
        <div *ngIf="UI.currentUser!=focusUserLastMessageObj?.user" (click)="newMessageToUser()" style="float:left;font-size:10px;padding:2px 4px 2px 4px;margin-right:5px;color:black;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer">New message to {{focusUserLastMessageObj?.name}}</div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div *ngIf="scope=='all'">
      <div class="material-icons" style="float:left;margin:5px;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="showTags=!showTags">filter_list</div>
      <div *ngIf="UI.tagFilters.length>0" style="float:left;font-size:10px;line-height:15px;padding:10px;color:black;cursor:pointer" (click)="UI.tagFilters=[];refreshMessages()">Clear {{UI.tagFilters.length}} filter{{UI.tagFilters.length>1?'s':''}}</div>
      <ul *ngIf="showTags" class="listLight">
        <li *ngFor="let message of tags|async" style="float:left"
          (click)="UI.tagFilters.includes(message.payload.doc.data()?.tag)?UI.tagFilters.splice(UI.tagFilters.indexOf(message.payload.doc.data()?.tag),1):UI.tagFilters.push(message.payload.doc.data()?.tag);refreshMessages()">
          <div *ngIf="message.payload.doc.data()?.tag" style="margin:5px;border-width:1px;border-style:solid"
            [style.color]="UI.tagFilters.includes(message.payload.doc.data()?.tag)?'white':'#666'"
            [style.background-color]="UI.tagFilters.includes(message.payload.doc.data()?.tag)?'black':'white'"
            [style.border-color]="UI.tagFilters.includes(message.payload.doc.data()?.tag)?'white':'#ddd'">
            <div style="width:100px;text-align:center;font-size:10px;font-weight:bold;padding:3px">{{message.payload.doc.data()?.tag}}</div>
          </div>
        </li>
      </ul>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div>
      <ul class="listLight">
        <li *ngFor="let message of comingEvents|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>-60">
          <div style="float:left;min-width:90px;min-height:40px">
            <span class="material-icons-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer;color:rgba(0,0,0,0.6)">event</span>
          </div>
          <div>
            <div style="float:left;margin-top:5px;width:60%;white-space:nowrap;text-overflow:ellipsis">
              <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">settings</span>
              <span style="font-size:14px;font-weight:bold">{{message.payload.doc.data()?.chatSubject}}{{message.payload.doc.data()?.recipientList.length>1?' ('+message.payload.doc.data()?.recipientList.length+')':''}}</span>
            </div>
            <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>-60" style="width:80%">
              <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>0" [style.background-color]="(math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>60*8)?'black':'red'" style="float:left;color:white;padding:0 5px 0 5px">in {{UI.formatSecondsToDhm2(message.payload.doc.data()?.eventDate/1000-UI.nowSeconds)}}</div>
              <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)<=0&&math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>-60" style="float:left;background-color:red;color:white;padding:0 5px 0 5px">Now</div>
              <div style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.eventDescription}}</div>
              <div style="float:left;margin:0 5px 0 0">{{message.payload.doc.data()?.eventDate|date:'EEEE d MMM HH:mm'}}</div>
            </div>
          </div>
          <div class="seperator"></div>
          </div>
        </li>
      </ul>
      <ul class="listLight">
        <li *ngFor="let message of currentSurveys|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="(UI.nowSeconds<message.payload.doc.data()?.survey?.expiryTimestamp/1000)&&message.payload.doc.data()?.survey?.createdTimestamp">
          <div style="float:left;min-width:90px;min-height:40px">
            <span class="material-icons-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer;color:rgba(0,0,0,0.6)">poll</span>
          </div>
          <div>
            <div style="float:left;margin-top:5px;width:60%;white-space:nowrap;text-overflow:ellipsis">
              <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">settings</span>
              <span style="font-size:14px;font-weight:bold">{{message.payload.doc.data()?.chatSubject}}{{message.payload.doc.data()?.recipientList.length>1?' ('+message.payload.doc.data()?.recipientList.length+')':''}}</span>
            </div>
            <div style="clear:both">
              <div [style.background-color]="(math.floor(message.payload.doc.data()?.survey.expiryTimestamp/3600000-UI.nowSeconds/3600)>8)?'black':'red'" style="float:left;color:white;padding:0 5px 0 5px">{{UI.formatSecondsToDhm2(message.payload.doc.data()?.survey.expiryTimestamp/1000-UI.nowSeconds)}} left</div>
              <div style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.survey.question}}</div>
              <span *ngFor="let answer of message.payload.doc.data()?.survey.answers;let last=last" [style.font-weight]="answer?.votes.includes(UI.currentUser)?'bold':'normal'" style="float:left;margin:0 5px 0 5px">{{answer.answer}} ({{(answer.votes.length/message.payload.doc.data()?.survey.totalVotes)|percent:'1.0-0'}})</span>
              <span style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.survey.totalVotes}} vote{{message.payload.doc.data()?.survey.totalVotes>1?'s':''}}</span>
              <div *ngIf="!message.payload.doc.data()?.recipients[UI.currentUser]?.voteIndexPlusOne" style="clear:both;color:red;margin:0 5px 0 5px">Vote now</div>
            </div>
          </div>
          </div>
          <div class="seperator"></div>
        </li>
      </ul>
      <ul class="listLight">
        <li *ngFor="let message of messages|async;let first=first;let last=last"
          (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div style="float:left;min-width:84px;min-height:40px">
              <img [src]="message.payload.doc.data()?.imageUrlThumbUser" style="float:left;margin:7px 2px 7px 4px;object-fit:cover;height:40px;width:40px;border-radius:50%">
              <img *ngIf="message.payload.doc.data()?.recipientList[1]" [src]="message.payload.doc.data()?.recipients[message.payload.doc.data()?.recipientList[1]]?.imageUrlThumb" style="float:left;margin:7px 4px 7px 2px;object-fit:cover;height:25px;width:25px;border-radius:50%">
            </div>
            <div>
              <div style="float:left;margin-top:5px;width:60%;white-space:nowrap;text-overflow:ellipsis">
                <span *ngIf="message.payload.doc.data()?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">settings</span>
                <span style="font-size:14px;font-weight:bold">{{message.payload.doc.data()?.chatSubject}}{{message.payload.doc.data()?.recipientList.length>1?' ('+message.payload.doc.data()?.recipientList.length+')':''}}</span>
              </div>
              <div style="float:right;margin:5px 0 0 0;width:35px;height:20px;line-height:20px;font-size:10px;text-align:center;border-radius:3px 0 0 3px"
                (click)="readFlagClick(message.payload.doc.id,(message.payload.doc.data()?.reads||{})[UI.currentUser])"
                [style.background-color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'whitesmoke':(message.payload.doc.data()?.recipients[UI.currentUser]?.mentionMessages||message.payload.doc.data()?.text.includes(UI.currentUserLastMessageObj?.name))?'magenta':message.payload.doc.data()?.recipients[UI.currentUser]?'red':message.payload.doc.data()?.recipients['xCxYTM0AD7aj5SKZ27iFaqJaXps1']?'red':'black'"
                [style.color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'whitesmoke':'white'">
                {{message.payload.doc.data()?.recipients[UI.currentUser]?.unreadMessages}}
              </div>
              <div style="float:right;margin-top:5px;color:#999;font-size:11px;margin-right:10px;width:40px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload.doc.data()?.serverTimestamp?.seconds)))}}</div>
              <div style="clear:both;float:left;height:42px;width:90%;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
                <span style="font-weight:bold;color:#555">{{message.payload.doc.data()?.name}}:&nbsp;</span>
                <span>{{(message.payload.doc.data()?.chatImageTimestamp!=''&&message.payload.doc.data()?.chatImageTimestamp!=undefined)?'(image) ':''}}{{message.payload.doc.data()?.text}}</span>
              </div>
            </div>
            <div class="seperator"></div>
          </div>
          <div *ngIf="scope!='all'&&(mode=='30days'||mode=='24months'||mode=='chain')">
            <div *ngIf="first">
              <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke">Date</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Days</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Messages</div>
              <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke">Balance</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Change</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Purchase</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Transaction</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Interest</div>
              <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Contract</div>
            </div>
            <div class="tableRow">
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd">{{(message.payload.doc.data()?.verifiedTimestamp?.seconds*1000)|date:'d MMM'}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(message.payload.doc.data()?.verifiedTimestamp?.seconds-previousTimestamp.seconds)/3600/24|number:'1.2-2'}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(message.payload.doc.data()?.userChain?.index-previousIndex)}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd">
                {{UI.formatCOINS(message.payload.doc.data()?.wallet?.shareBalance)}}
              </div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':UI.formatCOINS(message.payload.doc.data()?.wallet?.shareBalance-previousBalance)}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':UI.formatCOINS((message.payload.doc.data()?.purchaseCOIN?.amountCummulate||0)-previousPurchaseCOINAmountCummulate)|blankIfZero}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':UI.formatCOINS((message.payload.doc.data()?.transactionIn?.amountCummulate||0)-(message.payload.doc.data()?.transactionOut?.amountCummulate||0)-previousAmountTransactionCummulate)|blankIfZero}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':UI.formatCOINS((message.payload.doc.data()?.interest?.amountCummulate||0)-previousAmountInterestCummulate)|blankIfZero}}</div>
              <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':UI.formatCOINS((message.payload.doc.data()?.contract?.amountCummulate||0)-previousContractAmountCummulate)|blankIfZero}}</div>
            </div>
          </div>
          {{storeMessageValues(message.payload.doc.data())}}
        </li>
      </ul>
      <div class="spinner" *ngIf="UI.loading">
        <div class="bounce1"></div>
        <div class="bounce2"></div>
        <div class="bounce3"></div>
      </div>
      <div *ngIf="!UI.loading" style="color:black;width:200px;padding:15px;margin:0 auto;text-align:center;cursor:pointer" (click)="loadMore()">Load more</div>
      <div class="seperator"></div>
    </div>
  </div>
  `,
})
export class ProfileComponent {
  messages:Observable<any[]>
  comingEvents:Observable<any[]>
  currentSurveys:Observable<any[]>
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

  constructor(
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

  refreshMessages(){
    this.UI.loading=true
    if(this.scope=='all'){
      if(this.UI.tagFilters.length==0){
        this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('eventDate')
          .where('eventDate','>',(this.UI.nowSeconds-3600)*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('verified','==',true)
          .orderBy('survey.expiryTimestamp')
          .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
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
          .orderBy('eventDate')
          .where('eventDate','>',(this.UI.nowSeconds-3600)*1000)
        ).snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({payload:c.payload}))
        }))
        this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
          .where('lastMessage','==',true)
          .where('tag','in',this.UI.tagFilters)
          .where('verified','==',true)
          .orderBy('survey.expiryTimestamp')
          .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
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
    else if(this.mode=='30days'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .where('userChain.newDay','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='24months'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .where('userChain.newMonth','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(24)
      ).snapshotChanges().pipe(map(changes=>{
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
        .where('recipientList','array-contains-any',[this.scope,'xCxYTM0AD7aj5SKZ27iFaqJaXps1'])
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('eventDate')
        .where('eventDate','>',(this.UI.nowSeconds-3600)*1000)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope,'xCxYTM0AD7aj5SKZ27iFaqJaXps1'])
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('survey.expiryTimestamp')
        .where('survey.expiryTimestamp','>=',this.UI.nowSeconds*1000)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains-any',[this.scope,'xCxYTM0AD7aj5SKZ27iFaqJaXps1'])
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

  readFlagClick(messageId,readFlag){
    event.stopPropagation()
    if(readFlag)return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).delete()
    return this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(messageId).set({
      serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()
    })
  }

  showFullScreenImage(src) {
    const fullScreenImage=document.getElementById('fullScreenImage') as HTMLImageElement
    fullScreenImage.src=src
    fullScreenImage.style.visibility='visible'
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
      text:'Contract signature for position '+((this.focusUserLastMessageObj.contract||{}).position||null)+', level '+((this.focusUserLastMessageObj.contract||{}).level||0),
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
