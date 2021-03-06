import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import * as firebase from 'firebase/app'

@Component({
  selector: 'profile',
  template: `
  <div class='sheet'>
    <div *ngIf="!UI.currentUserLastMessageObj?.userStatus?.isMember" style="background-color:#f2f5d0;padding:5px">
      <div style="color:#777;font-size:10px;float:left">To become a PERRINN member and gain full access, you need to top up your COINS (go to your settings). If you have any question about the membership, feel free to chat with Nicolas.</div>
      <div style="color:#777;font-size:10px;float:left;line-height:16px;margin:0 5px 0 5px;padding:0 3px 0 3px;border-radius:3px;border-style:solid;border-width:1px;cursor:pointer" onclick="window.open('https://sites.google.com/view/perrinn/perrinn-com/membership','_blank')">More info about the membership</div>
      <div style="color:#777;font-size:10px;float:left;line-height:16px;margin:0 5px 0 5px;padding:0 3px 0 3px;border-radius:3px;border-style:solid;border-width:1px;cursor:pointer" (click)="router.navigate(['profile','QYm5NATKa6MGD87UpNZCTl6IolX2'])">Chat with Nicolas</div>
    </div>
    <div *ngIf="id=='PERRINN'" style="clear:both;background:whitesmoke">
      <div style="float:left">
        <img src="./../assets/App icons/Perrinn_02.png" style="display:inline;float:left;margin:7px;object-fit:cover;width:75px;height:75px;border-radius:50%;filter:invert(70%)">
      </div>
      <div style="padding:10px">
        <div style="clear:both;color:#222">
          <div style="float:left">
            <div style="font-size:20px">PERRINN</div>
            <div style="font-size:12px;line-height:14px"> We are a Team</div>
          </div>
        </div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div *ngIf="id!='PERRINN'" style="clear:both;background:whitesmoke">
      <div style="float:left">
        <img [src]="focusUserLastMessageObj?.imageUrlThumbUser" style="display:inline;float:left;margin:7px;object-fit:cover;width:75px;height:75px;border-radius:50%">
      </div>
      <div style="padding:10px">
        <div style="clear:both;color:#222">
          <div style="float:left">
            <span >{{focusUserLastMessageObj?.name}}</span>
            <span style="font-size:10px"> {{focusUserLastMessageObj?.familyName}}</span>
            <br>
            <span *ngIf="focusUserLastMessageObj?.userStatus?.isMember" style="font-size:10px">Member</span>
            <span *ngIf="focusUserLastMessageObj?.userStatus?.isDeveloper" style="font-size:10px"> Developer ({{focusUserLastMessageObj?.contract?.position}} Level {{focusUserLastMessageObj?.contract?.level}})</span>
            <span *ngIf="focusUserLastMessageObj?.userStatus?.isInvestor" style="font-size:10px"> Investor</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px;color:midnightblue">Waiting for contract signature</span>
            <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed&&UI.currentUser=='QYm5NATKa6MGD87UpNZCTl6IolX2'" style="margin:15px;font-size:10px;color:midnightblue;cursor:pointer" (click)=signContract()>Sign contract</span>
          </div>
          <div *ngIf="UI.currentUser!=focusUserLastMessageObj?.user" (click)="newMessageToUser()" style="float:right;font-size:10px;padding:2px 4px 2px 4px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer">New message to {{focusUserLastMessageObj?.name}}</div>
        </div>
        <div style="clear:both">
          <div style="clear:both;float:left;font-size:17px;color:green;margin-right:5px">{{(focusUserLastMessageObj?.wallet?.balance||0)|number:'1.2-2'}}</div>
          <div style="float:left;font-size:10px;color:green;line-height:25px">COINS</div>
          <div style="float:left;font-size:10px;color:midnightblue;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='inbox'?'underline':'none'" (click)="mode='inbox';refreshMessages()">inbox</div>
          <div style="float:left;font-size:10px;color:midnightblue;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='30days'?'underline':'none'" (click)="mode='30days';refreshMessages()">30 days</div>
          <div style="float:left;font-size:10px;color:midnightblue;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='24months'?'underline':'none'" (click)="mode='24months';refreshMessages()">24 months</div>
          <div style="float:left;font-size:10px;color:midnightblue;width:55px;text-align:center;line-height:25px;cursor:pointer" [style.text-decoration]="mode=='chain'?'underline':'none'" (click)="mode='chain';refreshMessages()">chain</div>
          <div style="clear:both;float:left;font-size:10px;color:#999">Created {{focusUserLastMessageObj?.createdTimestamp|date:'MMMM yyyy'}}, {{focusUserLastMessageObj?.userChain?.index}} Messages, {{focusUserLastMessageObj?.membership?.daysTotal|number:'1.1-1'}} Membership days, Verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</div>
        </div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <ul class="listLight">
      <li *ngFor="let message of comingEvents|async;let first=first;let last=last"
        (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
        <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>-60">
        <div style="float:left;min-width:90px;min-height:40px">
          <span class="material-icons-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="router.navigate(['search'])">event</span>
        </div>
        <div>
          <div style="clear:right;margin-top:5px;width:60%">
            <span *ngIf="message.payload.doc.data()?.isLog" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">fact_check</span>
            <div style="float:left;font-size:14px;font-weight:bold;white-space:nowrap;text-overflow:ellipsis">{{message.payload.doc.data()?.chatSubject}} </div>
          </div>
          <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>-60" style="width:80%">
            <div *ngIf="math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>0" [style.background-color]="(math.floor(message.payload.doc.data()?.eventDate/60000-UI.nowSeconds/60)>60*8)?'midnightblue':'red'" style="float:left;color:white;padding:0 5px 0 5px">in {{secondsToDhmDetail2(message.payload.doc.data()?.eventDate/1000-UI.nowSeconds)}}</div>
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
        <div style="float:left;min-width:90px;min-height:40px">
          <span class="material-icons-outlined" style="float:left;margin:7px 4px 7px 4px;font-size:40px;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="router.navigate(['search'])">poll</span>
        </div>
        <div>
          <div style="clear:right;margin-top:5px;width:60%">
            <span *ngIf="message.payload.doc.data()?.isLog" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">fact_check</span>
            <div style="float:left;font-size:14px;font-weight:bold;white-space:nowrap;text-overflow:ellipsis">{{message.payload.doc.data()?.chatSubject}} </div>
          </div>
          <div *ngIf="(math.floor(UI.nowSeconds/3600/24-message.payload.doc.data()?.survey?.createdTimestamp/3600000/24)<7)&&message.payload.doc.data()?.survey?.createdTimestamp" style="clear:both">
            <div [style.background-color]="(math.floor(7*24-UI.nowSeconds/3600+message.payload.doc.data()?.survey.createdTimestamp/3600000)>8)?'midnightblue':'red'" style="float:left;color:white;padding:0 5px 0 5px">{{secondsToDhmDetail2(7*24*3600-UI.nowSeconds+message.payload.doc.data()?.survey.createdTimestamp/1000)}} left</div>
            <div style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.survey.question}}</div>
            <span *ngFor="let answer of message.payload.doc.data()?.survey.answers;let last=last" [style.font-weight]="answer?.votes.includes(UI.currentUser)?'bold':'normal'" style="float:left;margin:0 5px 0 5px">{{answer.answer}} ({{(answer.votes.length/message.payload.doc.data()?.survey.totalVotes)|percent:'1.0-0'}})</span>
            <span style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.survey.totalVotes}} vote{{message.payload.doc.data()?.survey.totalVotes>1?'s':''}}</span>
            <div *ngIf="!message.payload.doc.data()?.recipients[UI.currentUser]?.voteIndexPlusOne" style="clear:both;color:red;margin:0 5px 0 5px">Vote now</div>
          </div>
        </div>
        <div class="seperator"></div>
      </li>
    </ul>
    <ul class="listLight">
      <li *ngFor="let message of messages|async;let first=first;let last=last"
        (click)="router.navigate(['chat',message.payload.doc.data()?.chain])">
        <div *ngIf="id=='PERRINN'||mode=='inbox'">
          <div style="float:left;min-width:90px;min-height:40px">
            <img [src]="message.payload.doc.data()?.imageUrlThumbUser" style="float:left;margin:7px 4px 7px 4px;object-fit:cover;height:40px;width:40px;border-radius:50%">
            <img *ngIf="message.payload.doc.data()?.recipientList[1]" [src]="message.payload.doc.data()?.recipients[message.payload.doc.data()?.recipientList[1]]?.imageUrlThumb" style="float:left;margin:7px 4px 7px 4px;object-fit:cover;height:25px;width:25px;border-radius:50%">
          </div>
          <div>
            <div style="clear:both;float:left;margin-top:5px;color:#111;font-size:14px">{{message.payload.doc.data()?.name}}</div>
            <div style="float:left;margin-top:5px;margin-left:5px;color:#111;font-size:11px">{{message.payload.doc.data()?.recipientList.length>1?'+'+(message.payload.doc.data()?.recipientList.length-1):''}}</div>
            <div style="float:right;margin:5px 0 0 0;width:35px;height:20px;line-height:20px;font-size:10px;text-align:center;border-radius:3px 0 0 3px"
            (click)="readFlagClick(message.payload.doc.id,(message.payload.doc.data()?.reads||{})[UI.currentUser])"
            [style.background-color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'whitesmoke':message.payload.doc.data()?.recipients[UI.currentUser]?'red':'midnightblue'"
            [style.color]="(message.payload.doc.data()?.reads||{})[UI.currentUser]?'whitesmoke':'white'">
              {{message.payload.doc.data()?.recipients[UI.currentUser]?.unreadMessages}}
            </div>
            <div style="float:right;margin-top:5px;color:#999;font-size:11px;margin-right:10px;width:40px">{{secondsToDhmDetail1(math.max(0,(UI.nowSeconds-message.payload.doc.data()?.serverTimestamp?.seconds)))}}</div>
            <div style="clear:right;margin-top:5px;width:60%">
              <span *ngIf="message.payload.doc.data()?.isLog" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;cursor:pointer;color:rgba(0,0,0,0.6)">fact_check</span>
              <div style="float:left;font-size:14px;font-weight:bold;white-space:nowrap;text-overflow:ellipsis">{{message.payload.doc.data()?.chatSubject}} </div>
            </div>
            <div style="clear:both;white-space:nowrap;width:80%;text-overflow:ellipsis;color:#888">{{message.payload.doc.data()?.text}}{{(message.payload.doc.data()?.chatImageTimestamp!=''&&message.payload.doc.data()?.chatImageTimestamp!=undefined)?' (image)':''}}</div>
          </div>
          <div class="seperator"></div>
        </div>
        <div *ngIf="id!='PERRINN'&&(mode=='30days'||mode=='24months'||mode=='chain')">
          <div *ngIf="first">
            <div style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke">Date</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Days</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Messages</div>
            <div style="float:left;text-align:center;width:100px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke">Balance</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Change</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Purchase</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Transaction</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Write</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Interest</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Membership</div>
            <div style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;background-color:whitesmoke;font-size:10px">Contract</div>
          </div>
          <div class="tableRow">
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:75px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd">{{(message.payload.doc.data()?.verifiedTimestamp?.seconds*1000)|date:'d MMM'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(message.payload.doc.data()?.verifiedTimestamp?.seconds-previousTimestamp.seconds)/3600/24|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(message.payload.doc.data()?.userChain?.index-previousIndex)}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:100px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd">{{message.payload.doc.data()?.wallet?.balance|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(message.payload.doc.data()?.wallet?.balance-previousBalance)|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':((message.payload.doc.data()?.purchaseCOIN?.amountCummulate||0)-previousPurchaseCOINAmountCummulate)|blankIfZero|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':((message.payload.doc.data()?.transactionIn?.amountCummulate||0)-(message.payload.doc.data()?.transactionOut?.amountCummulate||0)-previousAmountTransactionCummulate)|blankIfZero|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(previousAmountWriteCummulate-message.payload.doc.data()?.messagingCost?.amountWriteCummulate||0)|blankIfZero|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':((message.payload.doc.data()?.interest?.amountCummulate||0)-previousAmountInterestCummulate)|blankIfZero|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':(previousMembershipAmountCummulate-(message.payload.doc.data()?.membership?.amountCummulate||0))|blankIfZero|number:'1.2-2'}}</div>
            <div [style.color]="message.payload.doc.data()?.userChain?.nextMessage=='none'?'black':'grey'" style="float:left;text-align:center;width:65px;height:20px;border-style:solid;border-width:0 1px 1px 0;border-color:#ddd;font-size:10px">{{first?'':((message.payload.doc.data()?.contract?.amountCummulate||0)-previousContractAmountCummulate)|blankIfZero|number:'1.2-2'}}</div>
          </div>
        </div>
        {{storeMessageValues(message.payload.doc.data())}}
      </li>
    </ul>
    <div style="color:midnightblue;width:200px;padding:15px;margin:0 auto;text-align:center;cursor:pointer" (click)="loadMore()">Load more</div>
    <div class="seperator"></div>
  </div>
  `,
})
export class ProfileComponent {
  messages:Observable<any[]>
  comingEvents:Observable<any[]>
  currentSurveys:Observable<any[]>
  scrollTeam:string
  focusUserLastMessageObj:any
  id:string
  mode:string
  previousBalance:string
  previousTimestamp:string
  previousIndex:string
  previousPurchaseCOINAmountCummulate:number
  previousMembershipAmountCummulate:number
  previousContractAmountCummulate:number
  previousAmountWriteCummulate:number
  previousAmountInterestCummulate:number
  previousAmountTransactionCummulate:number
  math:any
  messageNumberDisplay:number

  constructor(
    public afs: AngularFirestore,
    public router: Router,
    public UI: UserInterfaceService,
    private route: ActivatedRoute
  ) {
    this.math=Math
    this.messageNumberDisplay=30
    this.id=''
    this.mode='inbox'
    this.scrollTeam=''
    this.route.params.subscribe(params => {
      this.id=params.id
      afs.collection<any>('PERRINNMessages',ref=>ref.where('user','==',this.id).where('verified','==',true).orderBy('serverTimestamp','desc').limit(1)).valueChanges().subscribe(snapshot=>{
        this.focusUserLastMessageObj=snapshot[0]
      })
      this.refreshMessages()
    })
  }

  refreshMessages(){
    this.comingEvents=this.afs.collection<any>('PERRINNMessages',ref=>ref
      .where('lastMessage','==',true)
      .where('verified','==',true)
      .orderBy('eventDate')
      .where('eventDate','>',(this.UI.nowSeconds-3600)*1000)
    ).snapshotChanges().pipe(map(changes=>{
      changes.forEach(c=>{
        this.UI.userObjectIndexPopulate(c.payload.doc.data())
      })
      return changes.map(c=>({payload:c.payload}))
    }))
    this.currentSurveys=this.afs.collection<any>('PERRINNMessages',ref=>ref
      .where('lastMessage','==',true)
      .where('verified','==',true)
      .orderBy('survey.createdTimestamp')
      .where('survey.createdTimestamp','>=',(this.UI.nowSeconds-7*24*3600)*1000)
    ).snapshotChanges().pipe(map(changes=>{
      changes.forEach(c=>{
        this.UI.userObjectIndexPopulate(c.payload.doc.data())
      })
      return changes.map(c=>({payload:c.payload}))
    }))
    if(this.id=='PERRINN'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('lastMessage','==',true)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        changes.forEach(c=>{
          this.UI.userObjectIndexPopulate(c.payload.doc.data())
        })
        return changes.map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='30days'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.id)
        .where('verified','==',true)
        .where('userChain.newDay','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        changes.forEach(c=>{
          this.UI.userObjectIndexPopulate(c.payload.doc.data())
        })
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='24months'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.id)
        .where('verified','==',true)
        .where('userChain.newMonth','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(24)
      ).snapshotChanges().pipe(map(changes=>{
        changes.forEach(c=>{
          this.UI.userObjectIndexPopulate(c.payload.doc.data())
        })
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else if(this.mode=='chain'){
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.id)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        changes.forEach(c=>{
          this.UI.userObjectIndexPopulate(c.payload.doc.data())
        })
        return changes.reverse().map(c=>({payload:c.payload}))
      }))
    }
    else{
      this.messages=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('recipientList','array-contains',this.id)
        .where('verified','==',true)
        .where('lastMessage','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        changes.forEach(c=>{
          this.UI.userObjectIndexPopulate(c.payload.doc.data())
        })
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
    let ID=this.newId()
    this.UI.createMessage({
      text:'Starting a new chat.',
      chain:ID,
      recipientList:[this.focusUserLastMessageObj.user]
    })
    this.router.navigate(['chat',ID])
  }

  newId():string{
    const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let autoId=''
    for(let i=0;i<20;i++){
      autoId+=chars.charAt(Math.floor(Math.random()*chars.length))
    }
    return autoId
  }

  storeMessageValues(message) {
    this.previousBalance=((message.wallet||{}).balance)||0
    this.previousTimestamp=message.verifiedTimestamp
    this.previousIndex=message.userChain.index
    this.previousPurchaseCOINAmountCummulate=(message.purchaseCOIN||{}).amountCummulate||0
    this.previousMembershipAmountCummulate=message.membership.amountCummulate||0
    this.previousContractAmountCummulate=(message.contract||{}).amountCummulate||0
    this.previousAmountWriteCummulate=message.messagingCost.amountWriteCummulate||0
    this.previousAmountInterestCummulate=(message.interest||{}).amountCummulate||0
    this.previousAmountTransactionCummulate=((message.transactionIn||{}).amountCummulate||0)-((message.transactionOut||{}).amountCummulate||0)
  }

  signContract(){
    this.UI.createMessage({
      chain:this.focusUserLastMessageObj.user,
      text:'Contract signature for position: '+((this.focusUserLastMessageObj.contract||{}).position||null)+', level: '+((this.focusUserLastMessageObj.contract||{}).level||0),
      contractSignature:{
        user:this.focusUserLastMessageObj.user,
        contract:this.focusUserLastMessageObj.contract||{}
      }
    })
    this.router.navigate(['chat',this.focusUserLastMessageObj.user])
  }

  secondsToDhmDetail2(seconds){
    seconds= Number(seconds)
    var d=Math.floor(seconds/(3600*24))
    var h=Math.floor(seconds%(3600*24)/3600)
    var m=Math.floor(seconds%3600/60)
    var dDisplay=d>0?d+'d ':''
    var hDisplay=h>0?h+'h ':''
    var mDisplay=(m>=0&&d==0)?m+'m ':''
    return dDisplay+hDisplay+mDisplay
  }

  secondsToDhmDetail1(seconds){
    seconds= Number(seconds)
    var d=Math.floor(seconds/(3600*24))
    var h=Math.floor(seconds%(3600*24)/3600)
    var m=Math.floor(seconds%3600/60)
    var dDisplay=d>0?d+'d ':''
    var hDisplay=(h>0&&d==0)?h+'h ':''
    var mDisplay=(m>=0&&d==0&&h==0)?m+'m ':''
    return dDisplay+hDisplay+mDisplay
  }

  loadMore() {
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }

}
