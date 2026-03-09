import { Component, NgZone, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireStorage } from '@angular/fire/compat/storage'
import firebase from 'firebase/compat/app'
import { map, tap, take } from 'rxjs/operators';

@Component({
  selector: 'chat',
  template: `

  <div class="chatPage" [ngStyle]="{'padding-top' : showChatDetails ? '0px' : showImageGallery ? '40px' : '20px' , 'padding-bottom' : chatPagePaddingBottom}">
  <div
    #chatTopBar
    class="chatTopBar"
    [style.top.px]="containerTop"
    [style.left.px]="containerLeft"
    [style.width.px]="containerWidth"
    (click)="UI.currentUser ? (showChatDetails = !showChatDetails) : '';showChatDetails?scrollMainToTop():scrollMainToBottom()">
    <div *ngIf="!showChatDetails">
      <div style="float:left;width:75%;margin:0 5px 0 10px;min-height:40px">
        <div class="chatHeaderSubjectRow">
          <img *ngIf="chatLastMessageObj?.chatProfileImageUrlThumb || chatLastMessageObj?.chatProfileImageUrlMedium"
            [src]="chatLastMessageObj?.chatProfileImageUrlThumb || chatLastMessageObj?.chatProfileImageUrlMedium"
            class="chatHeaderProfileImage"
            (error)="UI.handleChatImageError($event, chatLastMessageObj)">
          <div class="chatSubject chatSubjectStrong chatSubjectTruncate">{{chatLastMessageObj?.chatSubject}}</div>
        </div>
        <div style="width:100%;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;color:#94a3b8;font-size:12px;font-weight:500;line-height:1.4;margin-top:2px">
          <span *ngFor="let recipient of chatLastMessageObj?.recipientList;let last=last">{{recipient==UI.currentUser?'You':chatLastMessageObj?.recipients[recipient]?.name}}{{last?"":", "}}</span>
        </div>
        <div *ngIf="fund?.active" style="clear:both;padding-top:4px">
          <span class="material-symbols-outlined" style="float:left;font-size:20px;margin-right:5px;color:#10b981">crowdsource</span>
          <div style="overflow:hidden;padding-top:2px">
            <div style="background-color:#334155;height:20px;width:100%;border-radius:6px;overflow:hidden;position:relative;max-width:320px">
              <div style="height:100%;background: linear-gradient(90deg, #059669 0%, #047857 100%);display:flex;align-items:center;justify-content:center;transition:width 0.3s ease;"
                [style.width]="(fund?.amountGBPRaised/fund?.amountGBPTarget)*100+'%'">
                <span style="font-size: 10px; color: #ffffff; font-weight: 600; white-space: nowrap;" *ngIf="(fund?.amountGBPRaised/fund?.amountGBPTarget)*100 > 35">
                  {{(fund?.amountGBPRaised/fund?.amountGBPTarget)|percent:'1.0-0'}}
                </span>
              </div>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px">{{fund.daysLeft|number:'1.0-0'}} days left • {{fund.description}}</div>
          </div>
        </div>
      </div>
      <button class="topToggleBtn" (click)="$event.stopPropagation(); showImageGalleryClick()" aria-label="Toggle chat or gallery view">
        <span class="material-icons-outlined" style="font-size:20px;line-height:1">{{showImageGallery?'question_answer':'collections'}}</span>
      </button>
      <div *ngIf="eventDateEnd/60000>UI.nowSeconds/60" class="chatEventCard">
        <div class="chatEventMain">
          <span class="material-icons-outlined chatEventIcon">event</span>
          <span class="chatEventLabel">Next Event</span>
          <span class="chatEventTitleText">{{eventDescription}}</span>
          <span *ngIf="math.floor(eventDateStart/60000-UI.nowSeconds/60)>0" class="chatEventStatusChip">
            In {{UI.formatSecondsToDhm2(eventDateStart/1000-UI.nowSeconds)}}
          </span>
          <span *ngIf="math.floor(eventDateStart/60000-UI.nowSeconds/60)<=0&&eventDateEnd/60000>UI.nowSeconds/60" class="chatEventStatusChip chatEventStatusNow">
            Now
          </span>
          <span class="chatEventDateText">{{eventDateStart|date:'EEEE d MMM h:mm a'}} ({{eventDuration}}h)</span>
        </div>
        <button *ngIf="eventLocation"
          class="buttonPrimary chatEventJoinBtn"
          [disabled]="!UI.isCurrentUserMember"
          (click)="$event.stopPropagation(); UI.openWindow(eventLocation)">
          <span>Join</span>
          <span style="margin-left:5px;font-size:16px;line-height:14px" class="material-icons-outlined" *ngIf="!UI.isCurrentUserMember">lock</span>
        </button>
      </div>
    </div>
    <div *ngIf="showChatDetails">
      <div style="float:left;color:white;margin:10px">< messages</div>
    </div>
  </div>

  <div *ngIf="showChatDetails" class="chatDetailsPanel">
    <div class="island">
      <div class="chatProfileSection">
        <div class="chatProfileSectionTitle">Chat Profile</div>
        <div class="chatProfileSubjectRow">
          <input [(ngModel)]="chatSubject" class="chatProfileSubjectInput" placeholder="What is the subject of this chat?">
          <button class="buttonPrimary chatProfileBtn" (click)="saveNewSubject()" [disabled]="chatLastMessageObj?.chatSubject==chatSubject&&chatSubject">Save subject</button>
        </div>
        <div class="chatProfileImageEditor">
          <div class="chatProfileImagePreviewWrap">
            <img *ngIf="chatProfileImageDownloadUrl || chatLastMessageObj?.chatProfileImageUrlThumb || chatLastMessageObj?.chatProfileImageUrlMedium"
              [src]="chatProfileImageDownloadUrl || chatLastMessageObj?.chatProfileImageUrlThumb || chatLastMessageObj?.chatProfileImageUrlMedium"
              class="chatProfileImagePreview"
              (error)="UI.handleChatImageError($event, chatLastMessageObj)">
            <div *ngIf="!(chatProfileImageDownloadUrl || chatLastMessageObj?.chatProfileImageUrlThumb || chatLastMessageObj?.chatProfileImageUrlMedium)" class="chatProfileImagePlaceholder">
              <span class="material-icons-outlined" style="font-size:18px;line-height:1">image</span>
              <span>No chat image</span>
            </div>
          </div>
          <div class="chatProfileImageActions">
            <input type="file" name="chatProfileImage" id="chatProfileImage" class="inputfile" (change)="onChatProfileImageChange($event)" accept="image/*">
            <label class="buttonPrimary chatProfileBtn" for="chatProfileImage">Upload chat image</label>
            <button class="buttonPrimary chatProfileBtn" (click)="saveChatProfileImage()" [disabled]="!chatProfileImageTimestamp">Save chat image</button>
          </div>
        </div>
      </div>
    </div>
    <br/>

    <div class="island chatTransferSection">
      <div class="chatTransferHero">
        <div class="chatTransferTitle">Send PRN</div>
        <div class="chatTransferSubtitle">{{((UI.PERRINNAdminLastMessageObj?.currencyList||{})[UI.currentUserLastMessageObj.userCurrency]||{}).designation}} transfer to a chat member</div>
      </div>

      <div class="chatTransferBody">
        <div class="chatTransferFieldGrid">
          <input class="chatTransferInput" type="number" min="0" step="any" inputmode="decimal" maxlength="500" [(ngModel)]="transactionAmount" placeholder="Amount">
          <input class="chatTransferInput" maxlength="500" [(ngModel)]="transactionCode" placeholder="Code (optional)">
        </div>

        <input class="chatTransferInput chatTransferReference" maxlength="500" [(ngModel)]="transactionReference" placeholder="Reference">

        <div *ngIf="chatLastMessageObj?.recipientList?.length" class="chatTransferRecipients">
          <div class="chatTransferRecipientsLabel">Recipient</div>
          <ul class="listLight chatTransferRecipientsList">
            <li *ngFor="let recipient of chatLastMessageObj?.recipientList">
              <div class="chatTransferRecipientCard" (click)="transactionUser=recipient;transactionUserName=chatLastMessageObj?.recipients[recipient].name">
                <img [src]="chatLastMessageObj?.recipients[recipient]?.imageUrlThumb" class="chatTransferRecipientAvatar">
                <div class="chatTransferRecipientName">{{chatLastMessageObj?.recipients[recipient]?.name}}</div>
              </div>
            </li>
          </ul>
        </div>

        <div class="chatTransferActions">
          <button class="buttonPrimary chatTransferBtn" (click)="createTransactionOut(transactionAmount,transactionCode,transactionUser,transactionUserName,transactionReference)" [disabled]="!canSendTransactionOut()">
            Send {{UI.convertAndFormatPRNToPRNCurrency(null,transactionAmount*(((UI.PERRINNAdminLastMessageObj?.currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0))}} to {{transactionUserName}}
          </button>
          <button class="buttonPrimary chatTransferBtn" (click)="createTransactionPending(transactionAmount,transactionCode,null,null,transactionReference)" [disabled]="!canCreatePendingTransaction()">
            Create pending transaction of {{UI.convertAndFormatPRNToPRNCurrency(null,transactionAmount*(((UI.PERRINNAdminLastMessageObj?.currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0))}}
          </button>
        </div>
      </div>
    </div>
    <br/>

    <div class="island">
      <div class="chatEventEditor">
        <div class="chatEventEditorHeader">
          <span class="material-icons-outlined chatEventIcon">event</span>
          <span class="chatEventLabel">Event</span>
          <span class="chatEventEditorTitle">Edit Event</span>
        </div>

        <div *ngIf="eventDateEnd/60000>UI.nowSeconds/60" class="chatEventEditorPreview">
          <div class="chatEventMain">
            <span class="chatEventTitleText">{{eventDescription}}</span>
            <span *ngIf="math.floor(eventDateStart/60000-UI.nowSeconds/60)>0" class="chatEventStatusChip">
              In {{UI.formatSecondsToDhm2(eventDateStart/1000-UI.nowSeconds)}}
            </span>
            <span *ngIf="math.floor(eventDateStart/60000-UI.nowSeconds/60)<=0&&eventDateEnd/60000>UI.nowSeconds/60" class="chatEventStatusChip chatEventStatusNow">
              Now
            </span>
            <span class="chatEventDateText">{{eventDateStart==0?'':eventDateStart|date:'EEEE d MMM h:mm a'}} ({{eventDuration}}h)</span>
          </div>
        </div>

        <input class="chatEventEditorInput" maxlength="200" [(ngModel)]="eventDescriptionChoice" placeholder="Event description">

        <div class="chatEventEditorRow">
          <div class="chatEventEditorField">
            <div class="chatEventEditorFieldLabel">Date</div>
            <select [(ngModel)]="selectedDate" (change)="onDateChange($event)" class="chatEventEditorSelectDate">
              <option *ngFor="let date of eventDateListShort; let first=first" [value]="date">
                {{date | date:'EEEE'}}
                {{date | date:'d MMM'}}
              </option>
            </select>
          </div>
          <div class="chatEventEditorField">
            <div class="chatEventEditorFieldLabel">Time</div>
            <select [(ngModel)]="selectedTime" class="chatEventEditorSelectTime">
              <option *ngFor="let date of eventTimeList; let first=first" [value]="date">
                {{date | date:'h:mm a'}}
              </option>
            </select>
          </div>
          <div class="chatEventEditorField">
            <div class="chatEventEditorFieldLabel">Duration (hours)</div>
            <input class="chatEventEditorDuration" type="number" min="0" step="0.5" inputmode="decimal" maxlength="20" [(ngModel)]="eventDurationChoice" placeholder="e.g. 1.5">
          </div>
        </div>

        <input class="chatEventEditorInput" maxlength="200" [(ngModel)]="eventLocationChoice" placeholder="Event location">

        <div class="chatEventEditorActions">
          <button class="buttonPrimary chatEventEditorBtn" (click)="saveEvent()" [disabled]="!((eventDescriptionChoice!=chatLastMessageObj?.eventDescription||eventDurationChoice!=chatLastMessageObj?.eventDuration||eventLocationChoice!=chatLastMessageObj?.eventLocation||selectedTime!=chatLastMessageObj?.eventDateStart) && (selectedTime % 1800000) == 0 && (selectedTime != null))">Save event</button>
          <button class="buttonRed chatEventEditorBtn" (click)="cancelEvent()" [disabled]="!(eventDateEnd/60000>UI.nowSeconds/60)">Cancel event</button>
        </div>
      </div>
    </div>
    <br/>
    
    <div class="island">
      <div class="chatFundEditor">
        <div class="chatFundEditorHeader">
          <span class="material-icons-outlined chatEventIcon">crowdsource</span>
          <span class="chatEventLabel">Fund</span>
          <span class="chatFundEditorTitle">Edit Fund</span>
        </div>

        <div *ngIf="(fund?.amountGBPTarget||0) > 0" class="chatFundEditorPreview">
          <div class="chatFundEditorProgressTrack">
            <div class="chatFundEditorProgressFill"
              [style.width]="(((fund?.amountGBPRaised||0)/(fund?.amountGBPTarget||1))*100)+'%'">
              <span class="chatFundEditorProgressPct" *ngIf="((fund?.amountGBPRaised||0)/(fund?.amountGBPTarget||1))*100 > 30">
                {{((fund?.amountGBPRaised||0)/(fund?.amountGBPTarget||1))|percent:'1.0-0'}}
              </span>
            </div>
          </div>
          <div class="chatFundEditorMeta">
            <span class="chatFundEditorDays">{{fund?.daysLeft|number:'1.0-0'}} days left</span>
          </div>
          <div class="chatFundEditorDescription">{{fund?.description}}</div>
          <div class="chatFundEditorAmounts">
            target: {{UI.convertAndFormatPRNToCurrency(null,(fund?.amountGBPTarget||0)*(((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]||{}).toCOIN||0))}} /
            raised: {{UI.convertAndFormatPRNToCurrency(null,(fund?.amountGBPRaised||0)*(((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]||{}).toCOIN||0))}}
          </div>
        </div>

        <div class="chatFundEditorField">
          <div class="chatEventEditorFieldLabel">Fund description</div>
          <input class="chatFundEditorInput" maxlength="200" [(ngModel)]="fund.description" placeholder="Fund description">
        </div>

        <div class="chatFundEditorRow">
          <div class="chatFundEditorField">
            <div class="chatEventEditorFieldLabel">Amount target (GBP)</div>
            <input class="chatFundEditorInput" type="number" min="0" step="any" inputmode="decimal" maxlength="10" [(ngModel)]="fund.amountGBPTarget" placeholder="Amount target">
          </div>
          <div class="chatFundEditorField">
            <div class="chatEventEditorFieldLabel">Days left</div>
            <input class="chatFundEditorInput" type="number" min="0" step="1" inputmode="numeric" maxlength="10" [(ngModel)]="fund.daysLeft" placeholder="Days left">
          </div>
        </div>

        <button class="buttonWhite chatFundEditorBtn" (click)="saveFund()" [disabled]="!(fund.description!=chatLastMessageObj?.fund?.description||fund.amountGBPTarget!=chatLastMessageObj?.fund?.amountGBPTarget||fund.daysLeft!=chatLastMessageObj?.fund?.daysLeft)">Save fund</button>
      </div>
    </div>
  </div>

  <div *ngIf="!showChatDetails&&!showImageGallery">
    <div class="spinner" *ngIf="UI.loading">
      <div class="bounce1"></div>
      <div class="bounce2"></div>
      <div class="bounce3"></div>
    </div>
    <div>
      <ul>
        <li *ngFor="let message of messages|async;let first=first;let last=last;let i=index">
          <button class="buttonPrimary" *ngIf="first" [disabled]="isLoadMoreDisabled" [style.margin-top.px]="loadMoreButtonMarginTop" style="width:200px;margin-right:auto;margin-left:auto;margin-bottom:10px;display:flex;justify-content: center" (click)="loadMore()">Load more</button>
          <div class="island" id="date" style="margin-top:25px;margin-bottom:25px;max-width:240px" *ngIf="isMessageNewTimeGroup(message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first">
              <div style="margin:0 auto;text-align:center">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'fullDate'}}</div>
          </div>
          <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first" style="clear:both;width:100%;height:5px"></div>
          <div *ngIf="message.payload?.imageUrlThumbUser&&(isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first)" style="float:left;width:54px;min-height:10px">
            <img [src]="message.payload?.imageUrlThumbUser" (error)="UI.handleUserImageError($event, message.payload)" style="cursor:pointer;display:inline;float:left;margin:0 4px 10px 10px; object-fit:cover; height:35px; width:35px" (click)="router.navigate(['profile',message.payload?.user])">
          </div>
              <div [style.background-color]="(message.payload?.user==UI.currentUser)?'rgba(16, 185, 129, 0.14)':'rgba(15, 23, 42, 0.72)'"
                style="cursor:text;margin:0 16px 10px 56px;user-select:text;border-color:rgba(16, 185, 129, 0.45);border-radius:10px;padding:2px 2px 4px 2px"
                [style.border-style]="(message.payload?.text.includes(UI.currentUserLastMessageObj?.name))?'solid':'none'">
            <div>
              <div *ngIf="isMessageNewUserGroup(message.payload?.user,message.payload?.serverTimestamp||{seconds:UI.nowSeconds*1000})||first">
                <div class="messageAuthor" style="display:inline;float:left;margin:0px 10px 0px 5px">{{message.payload?.name}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)>43200" class="messageTiming" style="margin:0px 10px 0px 10px">{{(message.payload?.serverTimestamp?.seconds*1000)|date:'h:mm a'}}</div>
                <div *ngIf="(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)<=43200" class="messageTiming" style="margin:0px 10px 0px 10px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)))}}</div>
              </div>
              <div style="clear:both;text-align:center">
                <img class="imageWithZoom" *ngIf="message.payload?.chatImageTimestamp" [src]="message.payload?.chatImageUrlMedium" (error)="UI.handleChatImageError($event, message.payload)" style="max-width:70%;max-height:320px;width: auto; height: auto; margin:5px 10px 5px 5px; box-shadow: 0 0 2px whitesmoke" (click)="UI.showFullScreenImage(message.payload?.chatImageUrlOriginal)">
              </div>
              <div style="margin:5px 5px 0 5px;float:left">{{message.payload?.automaticMessage?"(Automatic)":""}}</div>
              <div class="messageBodyText" style="margin:5px 5px 0 5px" [innerHTML]="message.payload?.text | linky"></div>
              <div *ngIf="message.payload?.statistics?.userCount" style="float:left;margin:5px 5px 0 5px">{{message.payload?.statistics?.userCount}} users,</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">{{message.payload?.statistics?.membersCount}} members.</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.statistics?.wallet?.balance)}} invested.</div>
              <div *ngIf="message.payload?.statistics?.userCount" style="margin:5px 5px 0 5px">{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.membership?.amountRequired)}} membership threashold.</div>
              <div *ngIf="messageShowDetails.includes(message.key)" style="margin:5px">
                <div style="font-size:10px">userChain {{message.payload?.userChain|json}}</div>
                <div style="font-size:10px">transactionPending {{message.payload?.transactionPending|json}}</div>
                <div style="font-size:10px">transactionOut {{message.payload?.transactionOut|json}}</div>
                <div style="font-size:10px">transactionIn {{message.payload?.transactionIn|json}}</div>
                <div style="font-size:10px">Share purchase {{message.payload?.purchaseCOIN|json}}</div>
                <div style="font-size:10px">interest {{message.payload?.interest|json}}</div>
                <div style="font-size:10px">contract {{message.payload?.contract|json}}</div>
                <div style="font-size:10px">wallet {{message.payload?.wallet|json}}</div>
                <div style="font-size:10px">fund {{message.payload?.fund|json}}</div>
                <div style="font-size:10px">{{message.payload|json}}</div>
              </div>
            </div>
            <div style="cursor:pointer;clear:both;height:15px" (click)="messageShowActions.includes(message.key)?messageShowActions.splice(messageShowActions.indexOf(message.key),1):messageShowActions.push(message.key)">
              <span *ngIf="message.payload?.verified" class="material-icons" style="float:right;font-size:16px;margin:0 2px 2px 0;color:#3b82f6">check_circle</span>
              <span *ngIf="message.payload?.imageResized" class="material-icons-outlined" style="float:right;font-size:15px;margin:0 2px 2px 0">aspect_ratio</span>
              <span *ngIf="message.payload?.contract?.hoursValidated>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.contract?.amount)}} earned ({{UI.formatSecondsToDhm1(message.payload?.contract?.hoursValidated*3600)}}declared in {{UI.formatSecondsToDhm1(message.payload?.contract?.hoursAvailable*3600)}} window)</span>
              <span *ngIf="message.payload?.purchaseCOIN?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.purchaseCOIN?.amount)}} purchased</span>
              <span *ngIf="message.payload?.transactionIn?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">+{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.transactionIn?.amount)}} received</span>
              <span *ngIf="message.payload?.transactionOut?.amount>0" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">{{UI.convertAndFormatPRNToPRNCurrency(null,-message.payload?.transactionOut?.amount)}} sent</span>
              <span *ngIf="message.payload?.userChain?.nextMessage=='none'&&message.payload?.wallet?.balance!=undefined" style="float:right;font-size:10px;margin:0 5px 2px 0;line-height:15px">{{UI.convertAndFormatPRNToPRNCurrency(null,message.payload?.wallet?.balance)}}</span>
            </div>
            <div *ngIf="UI.currentUser&&messageShowActions.includes(message.key)">
              <div style="float:left;padding:5px;cursor:pointer" (click)="messageShowDetails.includes(message.key)?messageShowDetails.splice(messageShowDetails.indexOf(message.key),1):messageShowDetails.push(message.key)">Details</div>
            </div>
          </div>
          <div *ngIf="lastRead==message.key" style="margin:0 auto;text-align:center;font-size:12px;margin:35px 0 35px 0;border-style:solid;border-width:0 0 1px 0">Last read</div>
          {{storeMessageValues(message.payload)}}
        </li>
      </ul>
    </div>
  </div>

  <div *ngIf="!showChatDetails&&showImageGallery">
    <div class="spinner" *ngIf="UI.loading">
      <div class="bounce1"></div>
      <div class="bounce2"></div>
      <div class="bounce3"></div>
    </div>
    <div class="galleryWrap">
      <ul class="galleryGrid">
        <li *ngFor="let message of messages|async;let first=first;let last=last;let i=index" class="galleryCard" (click)="UI.showFullScreenImage(message.payload?.chatImageUrlOriginal)">
          <div class="galleryImageWrap">
            <img class="imageWithZoom galleryImage" *ngIf="message.payload?.chatImageTimestamp" [src]="message.payload?.chatImageUrlMedium||message.payload?.chatImageUrlThumb||message.payload?.chatImageUrlOriginal" (error)="UI.handleChatImageError($event, message.payload)">
          </div>
          <div class="galleryMeta">
            <div class="galleryTopRow">
              <span class="messageAuthor galleryAuthor">{{message.payload?.name || 'Member'}}</span>
              <span class="galleryTime messageTiming">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload?.serverTimestamp?.seconds)))}}</span>
            </div>
            <div class="galleryCaption">{{message.payload?.automaticMessage?"(Automatic) ":""}}{{message.payload?.text}}</div>
          </div>
        </li>
      </ul>
    </div>
    <div class="island" style="margin-top:25px;margin-bottom:25px;max-width:250px">
      <button class="buttonPrimary" style="width:200px;margin:10px auto" [disabled]="isLoadMoreDisabled" (click)="loadMore()">Load more</button>
    </div>
  </div>

  <div *ngIf="UI.currentUser&&!showImageGallery&&!showChatDetails"
    #chatComposer
    class="chatComposer"
    [style.bottom.px]="containerBottom"
    [style.left.px]="containerLeft"
    [style.width.px]="containerWidth">
    <span *ngIf="chatLastMessageObj?.chatSubject==null" style="margin:5px;font-size:10px">This message will be the subject of this chat</span>
    <div style="clear:both;float:left;width:90%;display:flex;align-items:center;min-height:64px">
      <textarea #msgBox
        autocapitalize="none"
        rows="1"
        style="float:left;padding:10px;resize:none;overflow-y:hidden;white-space:pre-wrap;word-break:break-word;background:rgba(15,23,42,0.65);border:1px solid rgba(148,163,184,0.3);border-radius:8px;color:#f1f5f9"
        [style.width]="imageDownloadUrl?'80%':'95%'"
        maxlength="500"
        (input)="autoResize(msgBox)"
        (keyup.enter)="addMessage()"
        [(ngModel)]="draftMessage"
        placeholder="Reply all"></textarea>
      <div *ngIf="imageDownloadUrl" style="float:left;width:15%">
        <img [src]="imageDownloadUrl" style="object-fit:cover;height:53px;margin:0 auto">
      </div>
    </div>
    <div *ngIf="draftMessage||imageDownloadUrl" class="composerActionWrap">
      <button class="composerActionBtn sendBtn" (click)="addMessage()" aria-label="Send message">
        <span class="material-icons-outlined" style="font-size:22px">send</span>
      </button>
    </div>
    <div *ngIf="!draftMessage&&!imageDownloadUrl" class="composerActionWrap">
      <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
      <label class="buttonUploadImage composerActionBtn cameraBtn" for="chatImage" id="buttonFile" aria-label="Upload image">
        <span class="material-icons-outlined" style="font-size:22px;color:#cbd5e1">photo_camera</span>
      </label>
    </div>
  </div>
</div>

`
})

export class ChatComponent implements OnDestroy {
  @ViewChild('msgBox') msgBox!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('chatTopBar') chatTopBar!: ElementRef;
  @ViewChild('chatComposer') chatComposer?: ElementRef<HTMLDivElement>;
  draftMessage:string
  imageTimestamp:string
  imageDownloadUrl:string
  chatProfileImageTimestamp:string
  chatProfileImageDownloadUrl:string
  transactionAmount:number
  transactionCode:string
  transactionReference:string
  transactionUser:string
  transactionUserName:string
  messageNumberDisplay:number
  lastChatVisitTimestamp:number
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
  messageShowActions:[]
  lastRead:string
  showImageGallery:boolean
  selectedDate: number;
  selectedTime: number;
  eventDateListShort: any;
  eventTimeList: any;
  testDay: any;
  dayOfToday: number;
  dateOfThatDay: Date;
  dateOfThisDay: Date;
  midnightOfThatDay: any;
  midnightOfThisDay: any;
  theDate: any;
  eventDescriptionChoice:string;
  eventDurationChoice:number;
  eventLocationChoice:string;
  googleMeet = "https://meet.google.com/ebp-djfh-aht";
  containerTop = 0;
  containerBottom = 0;
  containerLeft = 0;
  containerWidth = 0;
  composerHeight = 90;
  isLoadMoreDisabled = false;
  loadMoreButtonMarginTop = 75;
  private offsetsRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingLoadMoreAnchorRestore = false;
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
      this.reads = []
      this.route.params.subscribe(params => {
        this.lastRead = null
        this.chatChain = params.id
        this.messageShowActions = []
        this.messageShowDetails = []
        this.chatLastMessageObj = {}
        this.previousMessageServerTimestamp = { seconds: this.UI.nowSeconds * 1000 }
        this.previousMessageUser = ''
        this.messageNumberDisplay = 15
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
          daysLeft: 30
        }
        this.refreshMessages(params.id)
        this.refresheventDateList()
        this.resetChat()
      })
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

    this.containerTop = Math.max(0, (main?.top ?? r.top));
    this.containerBottom = keyboardLikelyOpen ? rawBottomOffset : 0;
    this.containerLeft = r.left;
    this.containerWidth = r.width;

    const composerEl = this.chatComposer?.nativeElement;
    this.composerHeight = composerEl ? composerEl.offsetHeight : 90;
  };

  get chatPagePaddingBottom(): string {
    if (!this.UI.currentUser || this.showChatDetails || this.showImageGallery) return '0px';
    return `${this.composerHeight + this.containerBottom + 8}px`;
  }

  updateLoadMoreMargin() {
    if (this.chatTopBar?.nativeElement) {
      this.loadMoreButtonMarginTop = this.chatTopBar.nativeElement.offsetHeight + 15;
    }
  }

  showImageGalleryClick() {
    event.stopPropagation()
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
    this.eventDateListShort = this.eventDateListShort.filter(item => item !== null && item !== undefined);
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
    this.eventTimeList = this.eventTimeList.filter(item => item !== null);
    //Suppression of every time slot which is too much 'in the past' compared to current time in second dropdown menu
    for (let j=0; j < this.eventTimeList.length; j++) {
      if (this.eventTimeList[j] < this.UI.nowSeconds * 1000 - 5400000) {
        this.eventTimeList[j] = null;
      }
    }
    this.eventTimeList = this.eventTimeList.filter(item => item !== null);
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

  refreshMessages(chain) {
    if (!this.showImageGallery) this.messages = this.afs.collection('PERRINNMessages', ref => ref
      .where('chain', '==', chain)
      .orderBy('serverTimestamp', 'desc')
      .limit(this.messageNumberDisplay)
    ).snapshotChanges().pipe(map(changes => {
      this.UI.loading = false
      this.isLoadMoreDisabled = changes.length < this.messageNumberDisplay;
      var batch = this.afs.firestore.batch()
      var nextMessageRead = true
      changes.forEach(c => {
        if (this.UI.currentUser && !this.lastRead && !nextMessageRead && (c.payload.doc.data()['reads'] || [])[this.UI.currentUser]) this.lastRead = c.payload.doc.id
        nextMessageRead = (c.payload.doc.data()['reads'] || [])[this.UI.currentUser]
        if (c.payload.doc.data()['lastMessage']) {
          if (this.UI.currentUser && !this.reads.includes(c.payload.doc.id)) batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id), { serverTimestamp: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj = c.payload.doc.data()
          this.chatSubject = c.payload.doc.data()['chatSubject']
          this.eventDescription = c.payload.doc.data()['eventDescription']
          this.eventDateStart = c.payload.doc.data()['eventDateStart']
          this.eventDateEnd = c.payload.doc.data()['eventDateEnd']
          this.eventDuration = c.payload.doc.data()['eventDuration'] || this.eventDuration
          this.eventLocation = c.payload.doc.data()['eventLocation'] || this.eventLocation
          this.fund = c.payload.doc.data()['fund'] || this.fund
          this.selectedDateInit();
          this.eventTimeListInit();
        }
      })
      batch.commit()
        return changes.reverse().map(c => ({
          key: c.payload.doc.id,
          payload: c.payload.doc.data()
        }))
      }),
      tap(() => {
        const shouldStickToBottom = this.shouldStickToBottomOnUpdate();
        this.zone.onStable.pipe(take(1)).subscribe(() => {
          this.updateLoadMoreMargin();
          const restoredAnchor = this.restoreLoadMoreAnchorIfNeeded();
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
      var batch = this.afs.firestore.batch()
      var nextMessageRead = true
      changes.forEach(c => {
        if (this.UI.currentUser && !this.lastRead && !nextMessageRead && (c.payload.doc.data()['reads'] || [])[this.UI.currentUser]) this.lastRead = c.payload.doc.id
        nextMessageRead = (c.payload.doc.data()['reads'] || [])[this.UI.currentUser]
        if (c.payload.doc.data()['lastMessage']) {
          if (this.UI.currentUser && !this.reads.includes(c.payload.doc.id)) batch.set(this.afs.firestore.collection('PERRINNTeams').doc(this.UI.currentUser).collection('reads').doc(c.payload.doc.id), { serverTimestamp: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
          this.reads.push(c.payload.doc.id)
          this.chatLastMessageObj = c.payload.doc.data()
          this.chatSubject = c.payload.doc.data()['chatSubject']
          this.eventDescription = c.payload.doc.data()['eventDescription']
          this.eventDateStart = c.payload.doc.data()['eventDateStart']
          this.eventDuration = c.payload.doc.data()['eventDuration'] || this.eventDuration
          this.eventLocation = c.payload.doc.data()['eventLocation'] || this.eventLocation
          this.fund = c.payload.doc.data()['fund'] || this.fund
          this.selectedDateInit();
          this.eventTimeListInit();
        }
      })
      batch.commit()
      return changes.map(c => ({
        key: c.payload.doc.id,
        payload: c.payload.doc.data()
      }))
    }))        
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

  storeMessageValues(message) {
    this.previousMessageUser = message.user
    this.previousMessageServerTimestamp = message.serverTimestamp || { seconds: this.UI.nowSeconds * 1000 }
  }

  scrollMainToBottom() {
    const mc = document.getElementById('main_container');
    if (mc) mc.scrollTop = mc.scrollHeight;
  }
  
  scrollMainToTop() {
    const mc = document.getElementById('main_container');
    if (mc) mc.scrollTop = 0;
  }

  private shouldStickToBottomOnUpdate(): boolean {
    const mc = document.getElementById('main_container');
    if (!mc) return true;
    const distanceFromBottom = mc.scrollHeight - (mc.scrollTop + mc.clientHeight);
    const isMobileViewport = window.matchMedia('(max-width: 900px)').matches;
    const threshold = isMobileViewport ? 180 : 90;
    return distanceFromBottom <= threshold;
  }

  private captureLoadMoreAnchor(): void {
    const mc = document.getElementById('main_container');
    if (!mc) return;
    this.pendingLoadMoreAnchorRestore = true;
    this.loadMoreAnchorTop = mc.scrollTop;
    this.loadMoreAnchorHeight = mc.scrollHeight;
  }

  private restoreLoadMoreAnchorIfNeeded(): boolean {
    if (!this.pendingLoadMoreAnchorRestore) return false;
    this.pendingLoadMoreAnchorRestore = false;
    const mc = document.getElementById('main_container');
    if (!mc) return false;
    const heightDelta = mc.scrollHeight - this.loadMoreAnchorHeight;
    mc.scrollTop = this.loadMoreAnchorTop + Math.max(0, heightDelta);
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

  canSendTransactionOut(): boolean {
    const amount = this.getTransferAmountValue();
    const balance = this.getTransferBalanceValue();
    return amount > 0
      && amount <= balance
      && this.transactionUser != undefined
      && this.hasTransactionReference();
  }

  canCreatePendingTransaction(): boolean {
    const amount = this.getTransferAmountValue();
    const balance = this.getTransferBalanceValue();
    return amount > 0
      && amount <= balance
      && this.transactionUser == undefined
      && this.hasTransactionReference();
  }

  createTransactionOut(transactionAmount, transactionCode, transactionUser, transactionUserName, transactionReference) {
    this.UI.createMessage({
      text: 'sending ' + ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).symbol||'') + transactionAmount + ' to ' + transactionUserName + ((transactionCode || null) ? ' using code ' : '') + ((transactionCode || null) ? transactionCode : '') + ' (Reference: ' + transactionReference + ')',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      transactionOut: {
        user: transactionUser,
        amount: transactionAmount * ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0),
        code: transactionCode || null,
        reference: transactionReference || null
      }
    })
    this.resetChat()
  }

  createTransactionPending(transactionAmount, transactionCode, transactionUser, transactionUserName, transactionReference) {
    this.UI.createMessage({
      text: 'creating a pending transaction of ' + ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).symbol||'') + transactionAmount + ((transactionCode || null) ? ' using code ' : '') + ((transactionCode || null) ? transactionCode : '') + ' (Reference: ' + transactionReference + ')',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      transactionPending: {
        amount: transactionAmount * ((((this.UI.PERRINNAdminLastMessageObj||{}).currencyList||{})[this.UI.currentUserLastMessageObj.userCurrency]||{}).toCOIN||0),
        code: transactionCode || null,
        reference: transactionReference || null
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

  saveFund() {
    this.UI.createMessage({
      text: 'edited fund',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      fund: this.fund
    })
    this.resetChat()
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

  removeRecipient(user, name) {
    this.UI.createMessage({
      text: 'removing ' + name + ' from this chat.',
      chain: this.chatLastMessageObj.chain || this.chatChain,
      recipientListToBeRemoved: [user]
    })
    this.resetChat()
  }

  onImageChange(event: any) {
    const image = event.target.files[0]
    const uploader = document.getElementById('uploader') as HTMLInputElement
    const storageRef = this.storage.ref('images/' + Date.now() + image.name)
    const task = storageRef.put(image)

    task.snapshotChanges().subscribe((snapshot) => {
      document.getElementById('buttonFile').style.visibility = 'hidden'
      document.getElementById('uploader').style.visibility = 'visible'

      const percentage = (snapshot.bytesTransferred / snapshot.totalBytes) * 100
      uploader.value = percentage.toString()
    },
      (err: any) => {
        document.getElementById('buttonFile').style.visibility = 'visible'
        document.getElementById('uploader').style.visibility = 'hidden'
        uploader.value = '0'
      },
      () => {
        uploader.value = '0'
        document.getElementById('buttonFile').style.visibility = 'visible'
        document.getElementById('uploader').style.visibility = 'hidden'
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
      if (this.searchFilter.length > 1) {
        this.teams = this.afs.collection('PERRINNMessages', ref => ref
          .where('userChain.nextMessage', '==', 'none')
          .where('verified', '==', true)
          .where('nameLowerCase', '>=', this.searchFilter.toLowerCase())
          .where('nameLowerCase', '<=', this.searchFilter.toLowerCase() + '\uf8ff')
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
    this.showChatDetails = false
    this.messageShowDetails = []
    this.messageShowActions = []
  
    // wait for view to settle, then resize if textarea exists
    this.zone.onStable.pipe(take(1)).subscribe(() => {
      const el = this.msgBox?.nativeElement;
      if (el) this.autoResize(el);
      this.updateFixedOffsets();
      this.scrollMainToBottom();
      setTimeout(() => {
        this.updateFixedOffsets();
        this.scrollMainToBottom();
      }, 180);
    });
  }
  

  autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    this.scheduleOffsetsRefresh();
  }

}