import { Component } from '@angular/core'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireStorage } from '@angular/fire/storage'
import * as firebase from 'firebase/app'

@Component({
  selector:'chat',
  template:`

  <div class="sheet">
    <div class="fixed" style="background:whitesmoke;color:#444;font-size:12px;cursor:pointer" (click)="showChatDetails=!showChatDetails">
      <div *ngIf="!showChatDetails" style="float:left;margin:0 5px 0 10px;min-height:40px">
        <div>
          <span *ngIf="chatLastMessageObj?.isSettings" class="material-icons" style="float:left;font-size:15px;margin:2px 5px 0 0;color:rgba(0,0,0,0.6)">settings</span>
          <div style="float:left;font-weight:bold">{{chatLastMessageObj?.chatSubject}}</div>
        </div>
        <span *ngFor="let recipient of chatLastMessageObj?.recipientList;let last=last">{{recipient==UI.currentUser?'You':chatLastMessageObj?.recipients[recipient]?.name}}{{last?"":", "}}</span>
        <div *ngIf="math.floor(eventDate/60000-UI.nowSeconds/60)>-60" style="clear:both">
          <span class="material-icons-outlined" style="float:left;font-size:20px;margin-right:5px;color:rgba(0,0,0,0.6)">event</span>
          <div [style.background-color]="(math.floor((eventDate/1000-UI.nowSeconds)/60)>60*8)?'midnightblue':'red'" style="float:left;color:white;padding:0 5px 0 5px">in {{UI.formatSecondsToDhm2(eventDate/1000-UI.nowSeconds)}}</div>
          <div *ngIf="math.floor(eventDate/60000-UI.nowSeconds/60)<=0&&math.floor(eventDate/60000-UI.nowSeconds/60)>-60" style="float:left;background-color:red;color:white;padding:0 5px 0 5px">Now</div>
          <div style="float:left;margin:0 5px 0 5px">{{eventDescription}}</div>
          <div style="float:left;margin:0 5px 0 0">{{eventDate|date:'EEEE d MMM HH:mm'}}</div>
        </div>
        <div *ngIf="(UI.nowSeconds<survey?.expiryTimestamp/1000)&&survey?.createdTimestamp" style="clear:both">
          <span class="material-icons-outlined" style="float:left;font-size:20px;margin-right:5px;color:rgba(0,0,0,0.6)">poll</span>
          <div [style.background-color]="(math.floor(survey.expiryTimestamp/3600000-UI.nowSeconds/3600)>8)?'midnightblue':'red'" style="float:left;color:white;padding:0 5px 0 5px">{{UI.formatSecondsToDhm2(survey.expiryTimestamp/1000-UI.nowSeconds)}} left</div>
          <div style="float:left;margin:0 5px 0 5px">{{survey.question}}</div>
          <span *ngFor="let answer of survey.answers;let last=last" [style.font-weight]="answer?.votes.includes(UI.currentUser)?'bold':'normal'" style="float:left;margin:0 5px 0 5px">{{answer.answer}} ({{(answer.votes.length/survey.totalVotes)|percent:'1.0-0'}})</span>
          <span style="float:left;margin:0 5px 0 5px">{{survey.totalVotes}} vote{{survey.totalVotes>1?'s':''}}</span>
          <div *ngIf="!chatLastMessageObj?.recipients[UI.currentUser]?.voteIndexPlusOne" style="clear:both;color:red;margin:0 5px 0 5px">vote now</div>
        </div>
      </div>
      <div *ngIf="showChatDetails" style="background:whitesmoke">
        <div style="float:left;font-size:12px;line-height:20px;margin:10px;color:midnightblue;cursor:pointer">< messages</div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
  </div>


  <div class="sheet" *ngIf="showChatDetails" style="padding-top:40px">
    <input [(ngModel)]="chatSubject" style="width:60%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" placeholder="What is the subject of this chat?">
    <div *ngIf="chatLastMessageObj?.chatSubject!=chatSubject&&chatSubject" style="float:right;width:75px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer" (click)="saveNewSubject()">Save</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
    <ul style="color:#333;margin:10px">
      <li *ngFor="let recipient of chatLastMessageObj?.recipientList" style="float:left">
        <div style="float:left;cursor:pointer" (click)="router.navigate(['profile',recipient])">
          <img [src]="chatLastMessageObj?.recipients[recipient]?.imageUrlThumb" style="float:left;object-fit:cover;height:25px;width:25px;border-radius:50%;margin:3px 3px 3px 10px">
          <div style="float:left;margin:10px 5px 3px 3px;font-size:12px;line-height:10px;font-family:sans-serif">{{chatLastMessageObj?.recipients[recipient]?.name}}</div>
        </div>
        <div style="float:left;cursor:pointer;font-weight:bold;margin:10px 15px 3px 3px;font-size:12px;line-height:10px;font-family:sans-serif;color:red" (click)="removeRecipient(recipient,chatLastMessageObj?.recipients[recipient]?.name)">X</div>
      </li>
    </ul>
    <input style="width:60%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="500" (keyup)="refreshSearchLists()" [(ngModel)]="searchFilter" placeholder="Add people">
    <ul class="listLight">
      <li *ngFor="let team of teams | async">
        <div *ngIf="!(chatLastMessageObj?.recipients||{})[team.key]" style="padding:5px">
          <div style="float:left;width:275px">
            <img [src]="team?.values?.imageUrlThumbUser" style="display:inline;float:left;margin:0 5px 0 10px;opacity:1;object-fit:cover;height:25px;width:25px;border-radius:50%">
            <span>{{team.values?.name}} {{UI.formatCOINS(team.values?.wallet?.balance||0)}}</span>
          </div>
          <div class="buttonDiv" style="float:left;width:50px;font-size:11px;background-color:midnightblue;color:white;border-style:none" (click)="addRecipient(team.values.user,team.values.name)">Add</div>
        </div>
      </li>
    </ul>
    <div class="seperator" style="width:100%;margin:0px"></div>
    <img class="imageWithZoom" [src]="chatLastMessageObj?.channelImageUrlMedium" style="object-fit:cover;margin:10px;border-radius:3px;height:50px;width:200px" (click)="showFullScreenImage(chatLastMessageObj?.channelImageUrlMedium)"
    onerror="this.onerror=null;this.src='https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1585144867972Screen%20Shot%202018-03-16%20at%2015.05.10_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=I3Kem9n6zYjSNijnKOx%2FAOUAg65GN3xf8OD1qD4uo%2BayOFblFIgfn81uPWRTzhGg14lJdyhz3Yx%2BiCXuYCIdYnduqMZcIjtHE6WR%2BPo74ckemuxIKx3N24tlBJ6DgkfgqwmIkw%2F%2FKotm8Cz%2Fq%2FbIZm%2FvAOi2dpBHqrHiIFXYb8AVYnhP1osUhVvyzapgYJEBZJcHur7v6uqrSKwQ4DfeHHinbJpvkX3wjM6Nxabi3kVABdGcGqMoAPGCTZJMzNj8xddAXuECbptQprd9LlnQOuL4tuDfLMAOUXTHmJVhJEBrquxQi8iPRjnLOvnqF8s2We0SOxprqEuwbZyxSgH05Q%3D%3D'">
    <br/>
    <div>
      <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="channelImageChange=true;draftMessage='updating the channel picture';onImageChange($event)" accept="image/*">
      <label class="buttonUploadImage" for="chatImage" id="buttonFile">
      <div style="clear:both;width:200px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer">Upload a new channel picture</div>
      </label>
    </div>
    <input [(ngModel)]="channelName" style="width:60%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" placeholder="What is the name of this channel?">
    <div *ngIf="chatLastMessageObj?.channelName!=channelName&&channelName" style="float:right;width:75px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer" (click)="saveNewChannelName()">Save</div>
    <ul style="color:#333;margin:10px">
      <li *ngFor="let channel of channels|async" style="float:left;font-size:12px;margin:3px 20px 3px 20px">
        <div *ngIf="channel.payload.doc.data().channel==chatLastMessageObj?.channel||(channel.payload.doc.data().channel==0&&chatLastMessageObj?.channel==undefined)">
          <div style="font-weight:bold">{{channel.payload.doc.data().channelName}}</div>
        </div>
        <div *ngIf="channel.payload.doc.data().channel!=chatLastMessageObj?.channel&&(channel!=0||chatLastMessageObj?.channel!=undefined)" style="cursor:pointer" (click)="switchChannel(channel.payload.doc.data().channel,channel.payload.doc.data().channelName)">
          <div style="color:midnightblue">switch to {{channel.payload.doc.data().channelName}}</div>
        </div>
      </li>
    </ul>
    <div class="seperator" style="width:100%;margin:0px"></div>
    <div *ngIf="chatLastMessageObj?.recipientList&&chatLastMessageObj?.recipientList.length!=2" style="font-size:10px;margin:10px;color:#777">To send COINS, chat must be between you and 1 other user only.</div>
    <div *ngIf="chatLastMessageObj?.recipientList&&chatLastMessageObj?.recipientList.length==2&&chatLastMessageObj?.recipientList.includes(UI.currentUser)">
      <div style="font-size:12px;margin:10px;color:#777">Send COINS to {{(chatLastMessageObj?.recipientList[0]==UI.currentUser)?(chatLastMessageObj?.recipients[chatLastMessageObj?.recipientList[1]].name):(chatLastMessageObj?.recipients[chatLastMessageObj?.recipientList[0]].name)}}</div>
      <input style="width:100px;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="500" (keyup)="inputsValid=checkInputs()" [(ngModel)]="amount" placeholder="Amount">
      <input style="width:150px;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="500" [(ngModel)]="code" placeholder="Code (optional)">
      <div *ngIf="amount>0&&amount<=UI.currentUserLastMessageObj?.wallet?.balance" style="clear:both;width:200px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer" (click)="sendCoins(amount,code)">
        Send {{amount}} Coins to {{(chatLastMessageObj?.recipientList[0]==UI.currentUser)?(chatLastMessageObj?.recipients[chatLastMessageObj?.recipientList[1]].name):(chatLastMessageObj?.recipients[chatLastMessageObj?.recipientList[0]].name)}}
      </div>
    </div>
    <div class="seperator" style="width:100%;margin:0px"></div>
    <div>
      <input style="width:60%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="200" [(ngModel)]="eventDescription" placeholder="Event description">
      <div style="font-size:12px;margin:10px;color:midnightblue">{{eventDate==0?'':eventDate|date:'EEEE d MMM HH:mm'}}</div>
      <div *ngIf="eventDate!=chatLastMessageObj?.eventDate||eventDescription!=chatLastMessageObj?.eventDescription" style="clear:both;width:100px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer" (click)="saveEvent()">Save event</div>
      <ul class="listLight" style="float:left;width:200px;margin:10px">
        <li *ngFor="let date of eventDates;let first=first" (click)="first?eventDate=date:eventDate=(date+(eventDate/3600000/24-math.floor(eventDate/3600000/24))*3600000*24)" [class.selected]="math.floor(date/3600000/24)==math.floor(eventDate/3600000/24)">
          <div *ngIf="math.round(date/3600000/24)==(date/3600000/24)||first" style="float:left;width:100px;min-height:10px">{{date|date:'EEEE'}}</div>
          <div *ngIf="math.round(date/3600000/24)==(date/3600000/24)||first" style="float:left;min-height:10px">{{date|date:'d MMM'}}</div>
        </li>
      </ul>
      <ul class="listLight" style="clear:none;float:left;width:100px;text-align:center;margin:10px">
        <li *ngFor="let date of eventDates;let first=first" (click)="eventDate=date" [class.selected]="eventDate==date">
          <div *ngIf="math.floor(date/3600000/24)==math.floor(eventDate/3600000/24)">{{date|date:'HH:mm'}}</div>
        </li>
      </ul>
    </div>
    <div class="seperator" style="width:100%;margin:0px"></div>
    <div>
      <div *ngIf="survey.createdTimestamp" style="font-size:12px;margin:10px;color:midnightblue">created on {{survey.createdTimestamp|date:'EEEE d MMM HH:mm'}} expiring on {{survey.expiryTimestamp|date:'EEEE d MMM HH:mm'}}</div>
      <span style="margin:10px">duration of the survey (days)</span>
      <input style="width:40%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="200" [(ngModel)]="survey.durationDays">
      <input style="width:80%;margin:10px;border:0;background:none;box-shadow:none;border-radius:0px" maxlength="200" [(ngModel)]="survey.question">
      <div style="clear:both;width:100px;height:20px;text-align:center;line-height:18px;font-size:10px;margin:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer" (click)="saveSurvey()">Save survey</div>
      <ul class="listLight" style="margin:10px">
        <li *ngFor="let answer of survey.answers;let i=index">
          <div>
            <div style="float:left;width:50px;margin:15px 5px 5px 0px">
              <div *ngIf="!answer?.votes.includes(UI.currentUser)" style="width:100%;height:20px;text-align:center;line-height:18px;font-size:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer" (click)="voteSurvey(i)">Vote</div>
            </div>
            <input style="float:left;width:70%;border:0;background:none;box-shadow:none;border-radius:0px" [style.font-weight]="answer?.votes.includes(UI.currentUser)?'bold':'normal'" [(ngModel)]="survey.answers[i].answer">
          </div>
          <span *ngFor="let user of answer?.votes;let last=last">{{user==UI.currentUser?'You':chatLastMessageObj?.recipients[user]?.name}}{{last?"":", "}}</span>
        </li>
      </ul>
    </div>
    <div style="width:75px;margin:10px;height:20px;text-align:center;line-height:18px;font-size:10px;color:midnightblue;border-style:solid;border-width:1px;border-radius:3px;cursor:pointer" (click)="survey.answers.push({answer:'new answer',votes:[]})">Add answer</div>
    <div class="seperator" style="width:100%;margin-bottom:150px"></div>
  </div>

  <div class="sheet" id="chat_window" style="overflow-y:auto;height:100%" *ngIf="!showChatDetails" scrollable>
    <div class="spinner" *ngIf="UI.loading">
      <div class="bounce1"></div>
      <div class="bounce2"></div>
      <div class="bounce3"></div>
    </div>
    <div>
      <ul style="list-style:none;">
        <li *ngFor="let message of messages|async;let first=first;let last=last;let i=index">
          <div *ngIf="isMessageNewTimeGroup(message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first" style="padding:100px 15px 15px 15px">
            <div *ngIf="first" style="color:midnightblue;width:200px;padding:15px;margin:0 auto;text-align:center;cursor:pointer" (click)="loadMore()">Load more</div>
            <div style="color:midnightblue;font-weight:bold;margin:0 auto;text-align:center">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'fullDate'}}</div>
          </div>
          <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first" style="clear:both;width:100%;height:15px"></div>
          <div *ngIf="message.payload?.imageUrlThumbUser&&(isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first)" style="float:left;width:60px;min-height:10px">
            <img [src]="message.payload?.imageUrlThumbUser" style="cursor:pointer;display:inline;float:left;margin:10px;border-radius:50%; object-fit:cover; height:35px; width:35px" (click)="router.navigate(['profile',message.payload?.user])">
          </div>
          <div [style.background-color]="(message.payload?.user==UI.currentUser)?'midnightblue':'white'"
                style="cursor:text;border-width:1px;margin:2px 10px 5px 60px;user-select:text"
                [style.color]="(message.payload?.user==UI.currentUser)?'#CCC':'#777'"
                [style.border-style]="(message.payload?.user==UI.currentUser)?'none':'solid'">
            <div>
              <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first">
                <div style="font-size:12px;font-weight:bold;display:inline;float:left;margin:0px 10px 0px 5px">{{message.payload?.name}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)>43200" style="font-size:11px;margin:0px 10px 0px 10px">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'HH:mm'}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)<=43200" style="font-size:11px;margin:0px 10px 0px 10px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)))}}</div>
              </div>
              <div style="float:left;margin:5px 5px 0 5px" [innerHTML]="message.payload?.text | linky"></div>
              <div style="clear:both;text-align:center">
                <img class="imageWithZoom" *ngIf="message.payload?.chatImageTimestamp" [src]="message.payload?.chatImageUrlMedium" style="clear:both;width:70%;max-height:320px;object-fit:contain;margin:5px 10px 5px 5px;border-radius:3px" (click)="showFullScreenImage(message.payload?.chatImageUrlOriginal)">
              </div>
              <div *ngIf="messageShowDetails.includes(message.key)" style="margin:5px">
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">userStatus {{message.payload?.userStatus|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">userChain {{message.payload?.userChain|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">transactionOut {{message.payload?.transactionOut|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">transactionIn {{message.payload?.transactionIn|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">COIN purchase {{message.payload?.purchaseCOIN|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">interest {{message.payload?.interest|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">contract {{message.payload?.contract|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">wallet {{message.payload?.wallet|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">survey {{message.payload?.survey|json}}</div>
                <div class="seperator" style="width:100%"></div>
                <div style="font-size:10px">{{message.payload|json}}</div>
              </div>
            </div>
            <div style="cursor:pointer;clear:both;height:15px" (click)="messageShowActions.includes(message.key)?messageShowActions.splice(messageShowActions.indexOf(message.key),1):messageShowActions.push(message.key)">
              <div style="float:left;width:100px;text-align:right;line-height:10px">...</div>
              <span *ngIf="message.payload?.verified" class="material-icons" style="float:right;font-size:15px;margin:0 2px 2px 0">done</span>
              <span *ngIf="message.payload?.imageResized" class="material-icons-outlined" style="float:right;font-size:15px;margin:0 2px 2px 0">aspect_ratio</span>
              <span *ngIf="message.payload?.contract?.hoursValidated>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.formatCOINS(message.payload?.contract?.amount)}} ({{UI.formatSecondsToDhm1(message.payload?.contract?.hoursValidated*3600)}}/{{UI.formatSecondsToDhm1(message.payload?.contract?.hoursAvailable*3600)}})</span>
              <span *ngIf="message.payload?.userChain?.nextMessage=='none'&&message.payload?.wallet?.balance!=undefined" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">{{UI.formatCOINS(message.payload?.wallet?.balance)}}</span>
            </div>
            <div *ngIf="messageShowActions.includes(message.key)">
              <div style="float:left;padding:5px;cursor:pointer;border-style:solid;border-width:1px 1px 0 0" (click)="messageShowDetails.includes(message.key)?messageShowDetails.splice(messageShowDetails.indexOf(message.key),1):messageShowDetails.push(message.key)">Details</div>
            </div>
          </div>
          <div *ngIf="lastRead==message.key" style="margin:0 auto;text-align:center;color:midnightblue;font-weight:bold;font-size:12px;margin:35px 0 35px 0;border-style:solid;border-width:0 0 2px 0">Last read</div>
          {{storeMessageValues(message.payload)}}
          {{(last||i==(messageNumberDisplay-1))?scrollToBottom(message.payload?.serverTimestamp?.seconds):''}}
        </li>
      </ul>
      <div style="height:100px;width:100%"></div>
    </div>
  </div>

  <div class="sheet">
    <div class="fixed" style="bottom:0">
      <span *ngIf="chatLastMessageObj?.chatSubject==null" style="margin:5px;font-size:10px">This message will be the subject of this chat</span>
      <div class="seperator" style="width:100%"></div>
      <div style="clear:both;float:left;width:90%">
        <textarea id="inputMessage" autocapitalize="none" style="float:left;border-style:solid;border-width:0 1px 0 0;border-color:#ddd;padding:9px;resize:none;overflow-y:scroll"  [style.width]="imageDownloadUrl?'85%':'95%'" maxlength="500" (keyup.enter)="addMessage()" [(ngModel)]="draftMessage" placeholder="Reply all"></textarea>
        <div *ngIf="imageDownloadUrl" style="float:left;width:15%">
          <img [src]="imageDownloadUrl" style="object-fit:cover;height:53px;margin:0 auto">
        </div>
      </div>
      <div *ngIf="draftMessage||imageDownloadUrl" style="float:right;width:10%;cursor:pointer">
        <span class="material-icons-outlined" style="margin:15px 5px 5px 5px;font-size:30px;color:rgba(0,0,0,0.6)" (click)="addMessage()">send</span>
      </div>
      <div *ngIf="!draftMessage&&!imageDownloadUrl" style="float:right;width:10%;cursor:pointer">
        <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
        <label class="buttonUploadImage" for="chatImage" id="buttonFile">
        <span class="material-icons-outlined" style="margin:15px 5px 5px 5px;font-size:30px;color:rgba(0,0,0,0.6)">photo_camera</span>
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
  channelName:string
  chatSubject:string
  chatLastMessageObj:any
  chatChain:string
  showChatDetails:boolean
  math:any
  eventDates:any
  eventDate:any
  eventDescription:string
  surveyDefault:any
  survey:any
  messageShowActions:[]
  lastRead:string
  channelImageChange:boolean
  channels:Observable<any[]>

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
      this.channelName=''
      this.chatSubject=''
      this.eventDescription=''
      this.channelImageChange=false
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
      this.refreshEventDates()
      this.resetChat()
      this.channels=this.afs.collection<any>('PERRINNMessages',ref=>ref
        .where('channelLastMessage','==',true)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc')
        .limit(this.messageNumberDisplay)
      ).snapshotChanges().pipe(map(changes=>{
        return changes.map(c=>({payload:c.payload}))
      }))
    })
  }

  ngOnInit() {
    this.refreshSearchLists()
  }

  loadMore() {
    this.UI.loading=true
    this.messageNumberDisplay+=15
    this.refreshMessages(this.chatLastMessageObj.chain||this.chatChain)
  }

  refreshEventDates(){
    var i
    this.eventDates=[]
    for(i=0;i<500;i++){
      this.eventDates[i]=(Math.ceil(this.UI.nowSeconds/3600)+i)*3600000
    }
  }

  refreshMessages(chain) {
    this.messages=this.afs.collection('PERRINNMessages',ref=>ref
      .where('chain','==',chain)
      .orderBy('serverTimestamp','desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes=>{
      this.UI.loading=false
      var batch=this.afs.firestore.batch()
      var nextMessageRead=true
      changes.forEach(c=>{
        if(!this.lastRead&&!nextMessageRead&&(c.payload.doc.data()['reads']||[])[this.UI.currentUser])this.lastRead=c.payload.doc.id
        nextMessageRead=(c.payload.doc.data()['reads']||[])[this.UI.currentUser]
        if(c.payload.doc.data()['lastMessage']){
          if(!this.reads.includes(c.payload.doc.id))batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id),{serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj=c.payload.doc.data()
          this.channelName=c.payload.doc.data()['channelName']
          this.chatSubject=c.payload.doc.data()['chatSubject']
          this.eventDescription=c.payload.doc.data()['eventDescription']
          this.eventDate=c.payload.doc.data()['eventDate']
          this.survey=((c.payload.doc.data()['survey']||{})['createdTimestamp'])?c.payload.doc.data()['survey']:this.survey
        }
      })
      batch.commit()
      return changes.reverse().map(c=>({
        key:c.payload.doc.id,
        payload:c.payload.doc.data()
      }))
    }))
  }

  showFullScreenImage(src) {
    const fullScreenImage=document.getElementById('fullScreenImage') as HTMLImageElement
    fullScreenImage.src=src
    fullScreenImage.style.visibility='visible'
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
      text:'Changing chat subject to '+this.chatSubject+" (was "+this.chatLastMessageObj.chatSubject+")",
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatSubject:this.chatSubject,
    })
    this.resetChat()
  }

  saveNewChannelName() {
    this.UI.createMessage({
      text:'Changing channel name to '+this.channelName+" (was "+this.chatLastMessageObj.channelName+")",
      chain:this.chatLastMessageObj.chain||this.chatChain,
      channelName:this.channelName,
    })
    this.resetChat()
  }

  switchChannel(channel,channelName) {
    this.UI.createMessage({
      text:'Switching to channel '+channelName,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      channel:channel,
    })
    this.resetChat()
  }

  sendCoins(amount,code){
    let user=''
    if (this.chatLastMessageObj.recipientList[0]==this.UI.currentUser)user=this.chatLastMessageObj.recipientList[1]
    else user=this.chatLastMessageObj.recipientList[0]
    this.UI.createMessage({
      text:'sending '+amount+' COINS'+((code||null)?' using code ':'')+((code||null)?code:''),
      chain:this.chatLastMessageObj.chain||this.chatChain,
      transactionOut:{
        user:user,
        amount:amount,
        code:code||null
      }
    })
    this.resetChat()
  }

  saveEvent() {
    this.UI.createMessage({
      text:'new event',
      chain:this.chatLastMessageObj.chain||this.chatChain,
      eventDate:this.eventDate,
      eventDescription:this.eventDescription
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
    let channelImageTimestamp=this.channelImageChange?this.imageTimestamp:null
    let channelImageDownloadUrl=this.channelImageChange?this.imageDownloadUrl:null
    this.UI.createMessage({
      text:this.draftMessage,
      chain:this.chatLastMessageObj.chain||this.chatChain,
      chatImageTimestamp:this.imageTimestamp,
      chatImageUrlThumb:this.imageDownloadUrl,
      chatImageUrlMedium:this.imageDownloadUrl,
      chatImageUrlOriginal:this.imageDownloadUrl,
      channelImageTimestamp:channelImageTimestamp,
      channelImageUrlThumb:channelImageDownloadUrl,
      channelImageUrlMedium:channelImageDownloadUrl
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
        if(this.channelImageChange)this.addMessage()
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
        .limit(10))
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
    this.searchFilter=''
    this.teams=null
    this.draftMessage=''
    this.imageTimestamp=''
    this.imageDownloadUrl=''
    this.showChatDetails=false
    this.messageShowDetails=[]
    this.messageShowActions=[]
    this.channelImageChange=false
  }

}
