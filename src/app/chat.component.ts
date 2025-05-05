import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireStorage } from '@angular/fire/compat/storage'
import firebase from 'firebase/compat/app'

@Component({
  selector:'chat',
  template:`

  <div class="sheet">
    <div class="fixed" style="background-color:black;font-size:12px;cursor:pointer" (click)="UI.currentUser?showChatDetails=!showChatDetails:''">
      <div *ngIf="!showChatDetails">
        <div style="float:left;width:80%;margin:0 5px 0 10px;min-height:40px">
          <div>
            <span *ngIf="chatLastMessageObj?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0">settings</span>
            <div style="float:left">{{chatLastMessageObj?.chatSubject}}</div>
          </div>
          <div style="width:100%;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical">
            <span *ngFor="let recipient of chatLastMessageObj?.recipientList;let last=last">{{recipient==UI.currentUser?'You':chatLastMessageObj?.recipients[recipient]?.name}}{{last?"":", "}}</span>
          </div>
          <div *ngIf="eventDateEnd/60000>UI.nowSeconds/60" style="clear:both">
            <span class="material-icons-outlined" style="float:left;font-size:20px;margin-right:5px">event</span>
            <div [style.background-color]="(math.floor((eventDateStart/1000-UI.nowSeconds)/60)>60*8)?'black':'red'" style="float:left;color:whitesmoke;padding:0 5px 0 5px">in {{UI.formatSecondsToDhm2(eventDateStart/1000-UI.nowSeconds)}}</div>
            <div *ngIf="math.floor(eventDateStart/60000-UI.nowSeconds/60)<=0&&eventDateEnd/60000>UI.nowSeconds/60" style="float:left;background-color:#D85140;color:whitesmoke;padding:0 5px 0 5px">Now</div>
            <span style="margin:0 5px 0 5px">{{eventDescription}}</span>
            <span style="margin:0 5px 0 0">{{eventDateStart|date:'EEEE d MMM h:mm a'}} ({{eventDuration}}h)</span>
          </div>
          <div *ngIf="fund?.active" style="clear:both">
            <span class="material-symbols-outlined" style="float:left;font-size:20px;margin-right:5px">crowdsource</span>
            <div style="float:left;background-color:black;height:20px;width:65px;text-align:center;color:whitesmoke;padding:0 5px 0 5px"></div>
            <div style="float:left;height:20px;background-color:#38761D;margin-left:-65px" [style.width]="(fund?.amountGBPRaised/fund?.amountGBPTarget)*65+'px'"></div>
            <div style="float:left;background-color:none;width:65px;margin-left:-65px;text-align:center;color:whitesmoke;padding:0 5px 0 5px">{{(fund?.amountGBPRaised/fund?.amountGBPTarget)|percent:'1.0-0'}}</div>
            <div style="float:left;margin:0 5px 0 5px">{{fund.daysLeft|number:'1.0-0'}} days left</div>
            <div style="float:left;margin:0 5px 0 0">{{fund.description}},</div>
            <div style="float:left;margin:0 5px 0 0">target: {{UI.formatSharesToCurrency(null,fund?.amountGBPTarget*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} /</div>
            <div style="float:left">raised: {{UI.formatSharesToCurrency(null,fund?.amountGBPRaised*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}}</div>
          </div>
          <div *ngIf="(UI.nowSeconds<survey?.expiryTimestamp/1000)&&survey?.createdTimestamp" style="clear:both">
            <span class="material-icons-outlined" style="float:left;font-size:20px;margin-right:5px">poll</span>
            <div [style.background-color]="(math.floor(survey.expiryTimestamp/3600000-UI.nowSeconds/3600)>8)?'black':'red'" style="float:left;color:whitesmoke;padding:0 5px 0 5px">{{UI.formatSecondsToDhm2(survey.expiryTimestamp/1000-UI.nowSeconds)}} left</div>
            <div style="float:left;margin:0 5px 0 5px">{{survey.question}}</div>
            <span *ngFor="let answer of survey.answers;let last=last" style="float:left;margin:0 5px 0 5px">{{answer.answer}} ({{(answer.votes.length/survey.totalVotes)|percent:'1.0-0'}})</span>
            <span style="float:left;margin:0 5px 0 5px">{{survey.totalVotes}} vote{{survey.totalVotes>1?'s':''}}</span>
            <div *ngIf="!chatLastMessageObj?.recipients[UI.currentUser]?.voteIndexPlusOne" style="clear:both;color:#D85140;margin:0 5px 0 5px">vote now</div>
          </div>
        </div>
        <span class="material-icons-outlined" style="float:right;padding:7px" (click)="showImageGalleryClick()">{{showImageGallery?'question_answer':'collections'}}</span>
        <div *ngIf="eventDateEnd/60000>UI.nowSeconds/60" style="clear:right">
          <span *ngIf="eventLocation" class="buttonBlack" style="float:right;padding:5px;margin:10px;line-height:13px" (click)="UI.openWindow(eventLocation)">Join</span>
        </div>
      </div>
      <div *ngIf="showChatDetails">
        <div style="float:left;font-size:12px;line-height:20px;margin:10px">< messages</div>
      </div>
      <div class="separator" style="width:100%;margin:0px"></div>
    </div>
  </div>


  <div class="sheet" *ngIf="showChatDetails" style="padding-top:40px">
    <input [(ngModel)]="chatSubject" style="width:60%;margin:10px" placeholder="What is the subject of this chat?">
    <div *ngIf="chatLastMessageObj?.chatSubject!=chatSubject&&chatSubject" style="float:right;width:75px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:whitesmoke;background-color:black;cursor:pointer" (click)="saveNewSubject()">Save</div>
    <div class="separator" style="width:100%;margin:0px"></div>
    <ul class="listLight" style="margin:10px">
      <li *ngFor="let recipient of chatLastMessageObj?.recipientList" style="float:left">
        <div style="float:left;cursor:pointer" (click)="router.navigate(['profile',recipient])">
          <img [src]="chatLastMessageObj?.recipients[recipient]?.imageUrlThumb" style="float:left;object-fit:cover;height:25px;width:25px;margin:3px 3px 3px 10px">
          <div style="float:left;margin:10px 5px 3px 3px;font-size:12px;line-height:10px;font-family:sans-serif">{{chatLastMessageObj?.recipients[recipient]?.name}}</div>
        </div>
        <div style="float:left;cursor:pointer;margin:10px 15px 3px 3px;font-size:12px;line-height:10px;font-family:sans-serif;color:#D85140" (click)="removeRecipient(recipient,chatLastMessageObj?.recipients[recipient]?.name)">X</div>
      </li>
    </ul>
    <input style="width:60%;margin:10px" maxlength="500" (keyup)="refreshSearchLists()" [(ngModel)]="searchFilter" placeholder="Add member">
    <ul class="listLight">
      <li *ngFor="let team of teams | async">
        <div *ngIf="!(chatLastMessageObj?.recipients||{})[team.key]" style="padding:5px">
          <div style="float:left;width:300px">
            <img [src]="team?.values?.imageUrlThumbUser" style="display:inline;float:left;margin:0 5px 0 10px;opacity:1;object-fit:cover;height:25px;width:25px">
            <span>{{team.values?.name}} {{UI.formatSharesToPRNCurrency(null,team.values?.wallet?.balance||0)}}</span>
          </div>
          <div class="buttonWhite" style="float:left;width:50px;font-size:11px" (click)="addRecipient(team.values.user,team.values.name)">Add</div>
        </div>
      </li>
    </ul>
    <div class="separator" style="width:100%;margin:0px"></div>
    <span style="margin:10px">Sending PRN {{UI.appSettingsPayment.currencyList[UI.currentUserLastMessageObj.userCurrency].designation}}:</span>
      <input style="width:200px;margin:10px" maxlength="500" [(ngModel)]="transactionAmount" placeholder="amount">
      <input style="width:150px;margin:10px" maxlength="500" [(ngModel)]="transactionCode" placeholder="Code (optional)">
      <div *ngIf="transactionAmount>0&&transactionAmount<=UI.currentUserLastMessageObj?.wallet?.balance">
        <ul class="listLight" style="margin:10px">
          <li *ngFor="let recipient of chatLastMessageObj?.recipientList" style="float:left">
            <div style="float:left;cursor:pointer" (click)="transactionUser=recipient;transactionUserName=chatLastMessageObj?.recipients[recipient].name">
              <img [src]="chatLastMessageObj?.recipients[recipient]?.imageUrlThumb" style="float:left;object-fit:cover;height:25px;width:25px;margin:3px 3px 3px 10px">
              <div style="float:left;margin:10px 5px 3px 3px;font-family:sans-serif">{{chatLastMessageObj?.recipients[recipient]?.name}}</div>
            </div>
          </li>
        </ul>
      </div>
      <div class="buttonWhite" *ngIf="transactionAmount>0&&transactionAmount<=UI.currentUserLastMessageObj?.wallet?.balance&&transactionUser!=undefined" style="clear:both;width:250px;font-size:10px;margin:10px" (click)="sendCredit(transactionAmount,transactionCode,transactionUser,transactionUserName)">
        Send {{UI.formatSharesToPRNCurrency(null,transactionAmount*UI.appSettingsPayment.currencyList[this.UI.currentUserLastMessageObj.userCurrency].toCOIN)}} to {{transactionUserName}}
      </div>
    <div class="separator" style="width:100%;margin:0px"></div>
    <div>
      <input style="width:60%;margin:10px" maxlength="200" [(ngModel)]="eventDescription" placeholder="Event description">
      <div style="font-size:12px;margin:10px">{{eventDateStart==0?'':eventDateStart|date:'EEEE d MMM h:mm a'}}</div>
      <div class="buttonWhite" *ngIf="eventDateStart!=chatLastMessageObj?.eventDateStart||eventDescription!=chatLastMessageObj?.eventDescription||eventDuration!=chatLastMessageObj?.eventDuration||eventLocation!=chatLastMessageObj?.eventLocation" style="clear:both;width:100px;font-size:10px;margin:10px" (click)="saveEvent()">Save event</div>
      <ul class="listLight" style="float:left;width:200px;margin:10px">
        <li *ngFor="let date of eventDateList;let first=first" (click)="first?eventDateStart=date:eventDateStart=(date+(eventDateStart/3600000/24-math.floor(eventDateStart/3600000/24))*3600000*24)" [class.selected]="math.floor(date/3600000/24)==math.floor(eventDateStart/3600000/24)">
          <div *ngIf="math.round(date/3600000/24)==(date/3600000/24)||first" style="float:left;width:100px;min-height:10px">{{date|date:'EEEE'}}</div>
          <div *ngIf="math.round(date/3600000/24)==(date/3600000/24)||first" style="float:left;min-height:10px">{{date|date:'d MMM'}}</div>
        </li>
      </ul>
      <ul class="listLight" style="clear:none;float:left;width:100px;text-align:center;margin:10px">
        <li *ngFor="let date of eventDateList;let first=first" (click)="eventDateStart=date" [class.selected]="eventDateStart==date">
          <div *ngIf="math.floor(date/3600000/24)==math.floor(eventDateStart/3600000/24)">{{date|date:'h:mm a'}}</div>
        </li>
      </ul>
    </div>
    <span style="margin:10px">Event duration (hours)</span>
    <input style="width:30%;margin:10px" maxlength="20" [(ngModel)]="eventDuration" placeholder="Event duration">
    <br/>
    <span style="margin:10px">Event location</span>
    <input style="width:50%;margin:10px" maxlength="200" [(ngModel)]="eventLocation" placeholder="Event location">
    <div class="buttonRed" *ngIf="chatLastMessageObj?.eventDateStart!=null" style="clear:both;width:100px;font-size:10px;margin:10px" (click)="cancelEvent()">Cancel event</div>
    <div class="separator" style="width:100%;margin:0px"></div>
    <div>
      <span style="margin:10px">Fund description</span>
      <input style="width:60%;margin:10px" maxlength="200" [(ngModel)]="fund.description">
      <br/>
      <span style="margin:10px">Amount target</span>
      <input style="width:30%;margin:10px" maxlength="10" [(ngModel)]="fund.amountGBPTarget">
      <br/>
      <span style="margin:10px">Days left</span>
      <input style="width:30%;margin:10px" maxlength="10" [(ngModel)]="fund.daysLeft">
      <div class="buttonWhite" *ngIf="fund.description!=chatLastMessageObj?.fund?.description||fund.amountGBPTarget!=chatLastMessageObj?.fund?.amountGBPTarget||fund.daysLeft!=chatLastMessageObj?.fund?.daysLeft" style="clear:both;width:100px;font-size:10px;margin:10px" (click)="saveFund()">Save fund</div>
    </div>
    <div class="separator" style="width:100%;margin:0px"></div>
    <div>
      <div *ngIf="survey.createdTimestamp" style="font-size:12px;margin:10px">created on {{survey.createdTimestamp|date:'EEEE d MMM h:mm a'}} expiring on {{survey.expiryTimestamp|date:'EEEE d MMM h:mm a'}}</div>
      <span style="margin:10px">Duration of the survey (days)</span>
      <input style="width:40%;margin:10px" maxlength="200" [(ngModel)]="survey.durationDays">
      <input style="width:80%;margin:10px" maxlength="200" [(ngModel)]="survey.question">
      <div class="buttonWhite" style="clear:both;width:100px;font-size:10px;margin:10px" (click)="saveSurvey()">Save survey</div>
      <ul class="listLight" style="margin:10px">
        <li *ngFor="let answer of survey.answers;let i=index">
          <div>
            <div style="float:left;width:50px;margin:15px 5px 5px 0px">
              <div class="buttonWhite" *ngIf="!answer?.votes.includes(UI.currentUser)" style="width:100%;font-size:10px" (click)="voteSurvey(i)">Vote</div>
            </div>
            <input style="float:left;width:70%" [(ngModel)]="survey.answers[i].answer">
          </div>
          <span *ngFor="let user of answer?.votes;let last=last">{{user==UI.currentUser?'You':chatLastMessageObj?.recipients[user]?.name}}{{last?"":", "}}</span>
        </li>
      </ul>
      <div class="buttonWhite" style="width:75px;margin:10px;font-size:10px" (click)="survey.answers.push({answer:'new answer',votes:[]})">Add answer</div>
    </div>
    <div class="separator" style="width:100%;margin-bottom:150px"></div>
  </div>

  <div class="sheet" id="chat_window" *ngIf="!showChatDetails&&!showImageGallery" style="padding:100px 0 0 0;overflow-y:auto;height:100%" scrollable>
    <div class="spinner" *ngIf="UI.loading">
      <div class="bounce1"></div>
      <div class="bounce2"></div>
      <div class="bounce3"></div>
    </div>
    <div>
      <ul style="list-style:none;">
        <li *ngFor="let message of messages|async;let first=first;let last=last;let i=index">
          <div *ngIf="isMessageNewTimeGroup(message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first" style="padding:15px">
            <div class="buttonWhite" *ngIf="first" style="width:200px;margin:10px auto" (click)="loadMore()">Load more</div>
            <div style="margin:0 auto;text-align:center">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'fullDate'}}</div>
          </div>
          <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first" style="clear:both;width:100%;height:15px"></div>
          <div *ngIf="message.payload?.imageUrlThumbUser&&(isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first)" style="float:left;width:60px;min-height:10px">
            <img [src]="message.payload?.imageUrlThumbUser" style="cursor:pointer;display:inline;float:left;margin:0 10px 10px 10px; object-fit:cover; height:35px; width:35px" (click)="router.navigate(['profile',message.payload?.user])">
          </div>
          <div [style.background-color]="(message.payload?.user==UI.currentUser)?'#222C32':'black'"
                style="cursor:text;margin:0 10px 5px 60px;user-select:text;border-color:magenta"
                [style.border-style]="(message.payload?.text.includes(UI.currentUserLastMessageObj?.name))?'solid':'none'">
            <div>
              <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first">
                <div style="font-size:12px;display:inline;float:left;margin:0px 10px 0px 5px">{{message.payload?.name}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)>43200" style="font-size:11px;margin:0px 10px 0px 10px">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'h:mm a'}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)<=43200" style="font-size:11px;margin:0px 10px 0px 10px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)))}}</div>
              </div>
              <div style="clear:both;text-align:center">
                <img class="imageWithZoom" *ngIf="message.payload?.chatImageTimestamp" [src]="message.payload?.chatImageUrlMedium" style="width:70%;max-height:320px;object-fit:contain;margin:5px 10px 5px 5px" (click)="UI.showFullScreenImage(message.payload?.chatImageUrlOriginal)">
              </div>
              <div style="margin:5px 5px 0 5px" [innerHTML]="message.payload?.text | linky"></div>
              <div *ngIf="message.payload?.statistics?.userCount" style="float:left;margin:5px 5px 0 5px">{{message.payload?.statistics?.userCount}} Members,</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">{{message.payload?.statistics?.emailsContributorsAuth?.length}} PRN holders.</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">{{UI.formatSharesToPRNCurrency(null,message.payload?.statistics?.wallet?.balance)}} invested.</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="float:left;margin:5px 5px 0 5px">{{UI.formatSharesToCurrency(null,message.payload?.statistics?.stripeBalance?.available[0]?.amount/100*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} available in the PERRINN fund</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">({{UI.formatSharesToCurrency(null,message.payload?.statistics?.stripeBalance?.pending[0]?.amount/100*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} pending).</div>
              <div *ngIf="messageShowDetails.includes(message.key)" style="margin:5px">
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">Email addresses {{message.payload?.emails|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">userChain {{message.payload?.userChain|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">transactionOut {{message.payload?.transactionOut|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">transactionIn {{message.payload?.transactionIn|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">Share purchase {{message.payload?.purchaseCOIN|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">interest {{message.payload?.interest|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">contract {{message.payload?.contract|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">wallet {{message.payload?.wallet|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">fund {{message.payload?.fund|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">survey {{message.payload?.survey|json}}</div>
                <div class="separator" style="width:100%"></div>
                <div style="font-size:10px">{{message.payload|json}}</div>
              </div>
            </div>
            <div style="cursor:pointer;clear:both;height:15px" (click)="messageShowActions.includes(message.key)?messageShowActions.splice(messageShowActions.indexOf(message.key),1):messageShowActions.push(message.key)">
              <span *ngIf="message.payload?.verified" class="material-icons" style="float:right;font-size:15px;margin:0 2px 2px 0">done</span>
              <span *ngIf="message.payload?.imageResized" class="material-icons-outlined" style="float:right;font-size:15px;margin:0 2px 2px 0">aspect_ratio</span>
              <span *ngIf="message.payload?.contract?.hoursValidated>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.formatSharesToPRNCurrency(null,message.payload?.contract?.amount)}} earned ({{UI.formatSecondsToDhm1(message.payload?.contract?.hoursValidated*3600)}}declared in {{UI.formatSecondsToDhm1(message.payload?.contract?.hoursAvailable*3600)}} window)</span>
              <span *ngIf="message.payload?.purchaseCOIN?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.formatSharesToPRNCurrency(null,message.payload?.purchaseCOIN?.amount)}} purchased</span>
              <span *ngIf="message.payload?.transactionIn?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.formatSharesToPRNCurrency(null,message.payload?.transactionIn?.amount)}} received</span>
              <span *ngIf="message.payload?.transactionOut?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">{{UI.formatSharesToPRNCurrency(null,-message.payload?.transactionOut?.amount)}} sent</span>
              <span *ngIf="message.payload?.userChain?.nextMessage=='none'&&message.payload?.wallet?.balance!=undefined" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">{{UI.formatSharesToPRNCurrency(null,message.payload?.wallet?.balance)}}</span>
            </div>
            <div *ngIf="UI.currentUser&&messageShowActions.includes(message.key)">
              <div style="float:left;padding:5px;cursor:pointer;border-style:solid 1px 0 0" (click)="messageShowDetails.includes(message.key)?messageShowDetails.splice(messageShowDetails.indexOf(message.key),1):messageShowDetails.push(message.key)">Details</div>
            </div>
          </div>
          <div *ngIf="lastRead==message.key" style="margin:0 auto;text-align:center;font-size:12px;margin:35px 0 35px 0;border-style:solid;border-width:0 0 1px 0">Last read</div>
          {{storeMessageValues(message.payload)}}
          {{(last||i==(messageNumberDisplay-1))?scrollToBottom(message.payload?.serverTimestamp?.seconds):''}}
        </li>
      </ul>
      <div style="height:150px;width:100%"></div>
    </div>
  </div>

  <div class="sheet" id="chat_window" *ngIf="!showChatDetails&&showImageGallery" style="padding:50px 0 0 0;overflow-y:auto;height:100%" scrollable>
    <div class="spinner" *ngIf="UI.loading">
      <div class="bounce1"></div>
      <div class="bounce2"></div>
      <div class="bounce3"></div>
    </div>
    <div>
      <ul style="list-style:none">
        <li *ngFor="let message of messages|async;let first=first;let last=last;let i=index" style="float:left;margin:5px;border-style:solid">
          <img class="imageWithZoom" *ngIf="message.payload?.chatImageTimestamp" [src]="message.payload?.chatImageUrlMedium" style="width:375px;height:200px;object-fit:contain" (click)="UI.showFullScreenImage(message.payload?.chatImageUrlOriginal)">
          <div style="margin:5px;width:365px;height:45px">
            <span>{{message.payload?.name}}: {{message.payload?.text}}</span>
          </div>
        </li>
      </ul>
      <div style="height:100px;width:100%"></div>
    </div>
  </div>

  <div class="sheet" *ngIf="UI.currentUser&&!showImageGallery">
    <div class="fixed" style="bottom:0;padding-bottom:25px">
      <span *ngIf="chatLastMessageObj?.chatSubject==null" style="margin:5px;font-size:10px">This message will be the subject of this chat</span>
      <div class="separator" style="width:100%"></div>
      <div style="clear:both;float:left;width:90%">
        <input autocapitalize="none" style="float:left;padding:10px;resize:none;overflow-y:scroll"  [style.width]="imageDownloadUrl?'80%':'95%'" maxlength="500" (keyup.enter)="addMessage()" [(ngModel)]="draftMessage" placeholder="Reply all">
        <div *ngIf="imageDownloadUrl" style="float:left;width:15%">
          <img [src]="imageDownloadUrl" style="object-fit:cover;height:53px;margin:0 auto">
        </div>
      </div>
      <div *ngIf="draftMessage||imageDownloadUrl" style="float:right;width:10%;cursor:pointer">
        <span class="material-icons-outlined" style="margin:15px 5px 5px 5px;font-size:30px" (click)="addMessage()">send</span>
      </div>
      <div *ngIf="!draftMessage&&!imageDownloadUrl" style="float:right;width:10%;cursor:pointer">
        <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
        <label class="buttonUploadImage" for="chatImage" id="buttonFile">
        <span class="material-icons-outlined" style="margin:15px 5px 5px 5px;font-size:30px;color:#B0BAC0">photo_camera</span>
        </label>
      </div>
    </div>
  </div>
    `
})
export class ChatComponent {
  draftMessage:string
  imageTimestamp:string
  imageDownloadUrl:string
  messageNumberDisplay:number
  lastChatVisitTimestamp:number
  scrollMessageTimestamp:number
  previousMessageServerTimestamp:any
  previousMessageUser:string
  messageShowDetails:[]
  messages:Observable<any[]>
  teams:Observable<any[]>
  searchFilter:string
  reads:any[]
  chatSubject:string
  chatLastMessageObj:any
  chatChain:string
  showChatDetails:boolean
  math:any
  eventDateList:any
  eventDateStart:any
  eventDateEnd:any
  eventDescription:string
  eventDuration:number
  eventLocation:string
  fund:any
  surveyDefault:any
  survey:any
  messageShowActions:[]
  lastRead:string
  showImageGallery:boolean

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private storage:AngularFireStorage,
  ) {
    this.math=Math
    this.UI.loading=true
    this.reads=[]
    this.route.params.subscribe(params=>{
      this.lastRead=null
      this.chatChain=params.id
      this.messageShowActions=[]
      this.messageShowDetails=[]
      this.chatLastMessageObj={}
      this.previousMessageServerTimestamp={seconds:this.UI.nowSeconds*1000}
      this.previousMessageUser=''
      this.messageNumberDisplay=15
      this.chatSubject=''
      this.eventDescription=''
      this.eventDuration=1
      this.eventLocation=""
      this.fund={
        description:'add a description',
        amountGBPTarget:0,
        daysLeft:30
      }
      this.surveyDefault={
        question:'Survey question',
        durationDays:7,
        answers:[
          {answer:'Answer A',votes:[]},
          {answer:'Answer B',votes:[]},
          {answer:'Answer C',votes:[]}
        ]
      }
      this.survey=this.surveyDefault
      this.refreshMessages(params.id)
      this.refresheventDateList()
      this.resetChat()
    })
  }

  ngOnInit(){
    this.refreshSearchLists()
  }

  showImageGalleryClick(){
    event.stopPropagation()
    this.showImageGallery=!this.showImageGallery
    this.refreshMessages(this.chatLastMessageObj.chain||this.chatChain)
  }

  loadMore(){
    this.UI.loading=true
    this.messageNumberDisplay+=15
    this.refreshMessages(this.chatLastMessageObj.chain||this.chatChain)
  }

  refresheventDateList(){
    var i
    this.eventDateList=[]
    for(i=0;i<2200;i++){
      this.eventDateList[i]=(Math.ceil(this.UI.nowSeconds/3600)+i/2)*3600000
    }
  }

  refreshMessages(chain) {
    if(!this.showImageGallery)this.messages=this.afs.collection('PERRINNMessages',ref=>ref
      .where('chain','==',chain)
      .orderBy('serverTimestamp','desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes=>{
      this.UI.loading=false
      var batch=this.afs.firestore.batch()
      var nextMessageRead=true
      changes.forEach(c=>{
        if(this.UI.currentUser&&!this.lastRead&&!nextMessageRead&&(c.payload.doc.data()['reads']||[])[this.UI.currentUser])this.lastRead=c.payload.doc.id
        nextMessageRead=(c.payload.doc.data()['reads']||[])[this.UI.currentUser]
        if(c.payload.doc.data()['lastMessage']){
          if(this.UI.currentUser&&!this.reads.includes(c.payload.doc.id))batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id),{serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj=c.payload.doc.data()
          this.chatSubject=c.payload.doc.data()['chatSubject']
          this.eventDescription=c.payload.doc.data()['eventDescription']
          this.eventDateStart=c.payload.doc.data()['eventDateStart']
          this.eventDateEnd=c.payload.doc.data()['eventDateEnd']
          this.eventDuration=c.payload.doc.data()['eventDuration']
          this.eventLocation=c.payload.doc.data()['eventLocation']
          this.fund=c.payload.doc.data()['fund']||this.fund
          this.survey=((c.payload.doc.data()['survey']||{})['createdTimestamp'])?c.payload.doc.data()['survey']:this.survey
        }
      })
      batch.commit()
      return changes.reverse().map(c=>({
        key:c.payload.doc.id,
        payload:c.payload.doc.data()
      }))
    }))
    else this.messages=this.afs.collection('PERRINNMessages',ref=>ref
      .where('chain','==',chain)
      .orderBy('chatImageTimestamp','desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes=>{
      this.UI.loading=false
      var batch=this.afs.firestore.batch()
      var nextMessageRead=true
      changes.forEach(c=>{
        if(this.UI.currentUser&&!this.lastRead&&!nextMessageRead&&(c.payload.doc.data()['reads']||[])[this.UI.currentUser])this.lastRead=c.payload.doc.id
        nextMessageRead=(c.payload.doc.data()['reads']||[])[this.UI.currentUser]
        if(c.payload.doc.data()['lastMessage']){
          if(this.UI.currentUser&&!this.reads.includes(c.payload.doc.id))batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id),{serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj=c.payload.doc.data()
          this.chatSubject=c.payload.doc.data()['chatSubject']
          this.eventDescription=c.payload.doc.data()['eventDescription']
          this.eventDateStart=c.payload.doc.data()['eventDateStart']
          this.eventDuration=c.payload.doc.data()['eventDuration']
          this.eventLocation=c.payload.doc.data()['eventLocation']
          this.fund=c.payload.doc.data()['fund']||this.fund
          this.survey=((c.payload.doc.data()['survey']||{})['createdTimestamp'])?c.payload.doc.data()['survey']:this.survey
        }
      })
      batch.commit()
      return changes.map(c=>({
        key:c.payload.doc.id,
        payload:c.payload.doc.data()
      }))
    }))
  }

  isMessageNewTimeGroup(messageServerTimestamp:any) {
    let isMessageNewTimeGroup:boolean
    isMessageNewTimeGroup=Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 60 * 4
    return isMessageNewTimeGroup
  }

  isMessageNewUserGroup(user:any,messageServerTimestamp:any) {
    let isMessageNewUserGroup:boolean
    isMessageNewUserGroup=Math.abs(messageServerTimestamp.seconds - this.previousMessageServerTimestamp.seconds) > 60 * 5 || (user != this.previousMessageUser)
    return isMessageNewUserGroup
  }

  storeMessageValues(message) {
    this.previousMessageUser=message.user
    this.previousMessageServerTimestamp=message.serverTimestamp||{seconds:this.UI.nowSeconds*1000}
  }

  scrollToBottom(scrollMessageTimestamp:number) {
    if (scrollMessageTimestamp != this.scrollMessageTimestamp) {
      const element=document.getElementById('chat_window')
      element.scrollTop=element.scrollHeight
      this.scrollMessageTimestamp=scrollMessageTimestamp
    }
  }

  saveNewSubject() {
    this.UI.createMessage({
      text:'Changing subject to '+this.chatSubject,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatSubject:this.chatSubject,
    })
    this.resetChat()
  }

  sendCredit(transactionAmount,transactionCode,transactionUser,transactionUserName){
    this.UI.createMessage({
      text:'sending '+this.UI.appSettingsPayment.currencyList[this.UI.currentUserLastMessageObj.userCurrency].symbol+transactionAmount+' to '+transactionUserName+((transactionCode||null)?' using code ':'')+((transactionCode||null)?transactionCode:''),
      chain:this.chatLastMessageObj.chain||this.chatChain,
      transactionOut:{
        user:transactionUser,
        amount:transactionAmount*this.UI.appSettingsPayment.currencyList[this.UI.currentUserLastMessageObj.userCurrency].toCOIN,
        code:transactionCode||null
      }
    })
    this.resetChat()
  }

  saveEvent() {
    this.UI.createMessage({
      text:'new event',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      eventDateStart:this.eventDateStart,
      eventDateEnd:this.eventDateStart+this.eventDuration*3600000,
      eventDescription:this.eventDescription,
      eventDuration:this.eventDuration,
      eventLocation:this.eventLocation
    })
    this.resetChat()
  }

  cancelEvent() {
    this.UI.createMessage({
      text:'cancelling event',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      eventDateStart:this.UI.nowSeconds*1000-3600000,
      eventDateEnd:this.UI.nowSeconds*1000-3600000
    })
    this.resetChat()
  }

  saveFund() {
    this.UI.createMessage({
      text:'edited fund',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      fund:this.fund
    })
    this.resetChat()
  }

  saveSurvey() {
    this.UI.createMessage({
      text:'Survey saved',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      survey:this.survey
    })
    this.resetChat()
  }

  voteSurvey(i) {
    this.UI.createMessage({
      text:'Survey vote '+this.survey.answers[i].answer,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      survey:{voteIndexPlusOne:i+1}
    })
    this.resetChat()
  }

  addMessage() {
    this.UI.createMessage({
      text:this.draftMessage,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatImageTimestamp:this.imageTimestamp,
      chatImageUrlThumb:this.imageDownloadUrl,
      chatImageUrlMedium:this.imageDownloadUrl,
      chatImageUrlOriginal:this.imageDownloadUrl
    })
    this.resetChat()
  }

  addRecipient(user,name) {
    this.UI.createMessage({
      text:'adding '+name+' to this chat.',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      recipientList:[user]
    })
    this.resetChat()
  }

  removeRecipient(user,name){
    this.UI.createMessage({
      text:'removing '+name+' from this chat.',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      recipientListToBeRemoved:[user]
    })
    this.resetChat()
  }

  onImageChange(event:any) {
    const image=event.target.files[0]
    const uploader=document.getElementById('uploader') as HTMLInputElement
    const storageRef=this.storage.ref('images/' + Date.now() + image.name)
    const task=storageRef.put(image)

    task.snapshotChanges().subscribe((snapshot)=>{
      document.getElementById('buttonFile').style.visibility='hidden'
      document.getElementById('uploader').style.visibility='visible'

      const percentage=(snapshot.bytesTransferred / snapshot.totalBytes) * 100
      uploader.value=percentage.toString()
    },
    (err:any)=>{
      document.getElementById('buttonFile').style.visibility='visible'
      document.getElementById('uploader').style.visibility='hidden'
      uploader.value='0'
    },
    ()=>{
      uploader.value='0'
      document.getElementById('buttonFile').style.visibility='visible'
      document.getElementById('uploader').style.visibility='hidden'
      this.imageTimestamp=task.task.snapshot.ref.name.substring(0, 13)
      storageRef.getDownloadURL().subscribe(url=>{
        this.imageDownloadUrl=url
        event.target.value=''
      })
    })
  }

  refreshSearchLists() {
    if (this.searchFilter) {
      if (this.searchFilter.length > 1) {
        this.teams=this.afs.collection('PERRINNMessages', ref=>ref
        .where('userChain.nextMessage','==','none')
        .where('verified','==',true)
        .where('nameLowerCase','>=',this.searchFilter.toLowerCase())
        .where('nameLowerCase','<=',this.searchFilter.toLowerCase()+'\uf8ff')
        .orderBy('nameLowerCase')
        .limit(20))
        .snapshotChanges().pipe(map(changes=>{
          return changes.map(c=>({
            key:c.payload.doc.id,
            values:c.payload.doc.data()
          }))
        }))
      }
    } else {
      this.teams=null
    }
  }

  resetChat(){
    this.searchFilter=null
    this.teams=null
    this.draftMessage=''
    this.imageTimestamp=null
    this.imageDownloadUrl=null
    this.showChatDetails=false
    this.messageShowDetails=[]
    this.messageShowActions=[]
  }

}
