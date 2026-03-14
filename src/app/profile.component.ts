import { Component } from '@angular/core'
import { Subscription } from 'rxjs'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFireAuth } from '@angular/fire/compat/auth'
import firebase from 'firebase/compat/app'
import { AgChartOptions } from 'ag-charts-community'
import { ChangeDetectorRef } from '@angular/core'

@Component({
  selector:'profile',
  template:`

  <div class="profileModern">
  <div class="profileContainer" [class.nonMemberView]="!UI.isCurrentUserMember">

  <div class="island" *ngIf="UI.currentUserLastMessageObj&&!UI.currentUserLastMessageObj?.isImageUserUpdated"
        style="background-color:rgb(255, 251, 221); color: #333; cursor:pointer"
        (click)="router.navigate(['settings'])">
      Add a profile picture.
  </div>

  <div class="island" *ngIf="UI.hasTouch&&!UI.isStandalone"
    style="background-color:rgb(255, 251, 221); color: #333">
    Add this app to your home screen for a better experience.
  </div>

  <div class="island profile-banner-item" *ngIf="scope=='all'&&UI.PERRINNProfileLastMessageObj?.imageUrlOriginal!=undefined" style="line-height:0px;clear:both">
    <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%;display:block">
  </div>

  <div class="island" *ngIf="scope!='all'" style="padding:14px;">
    <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;">
      <img *ngIf="focusUserLastMessageObj"
        [src]="focusUserLastMessageObj?.imageUrlMedium"
        (error)="UI.handleUserImageError($event, focusUserLastMessageObj)"
        style="object-fit:cover;width:132px;height:132px;border-radius:12px;border:1px solid rgba(16,185,129,0.18);cursor:pointer;flex-shrink:0;"
        (click)="UI.showFullScreenImage(focusUserLastMessageObj?.imageUrlOriginal)">

      <div style="flex:1; min-width:240px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <span style="color:#f1f5f9;font-size:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">{{focusUserLastMessageObj?.name}}</span>
            <span *ngIf="focusUserLastMessageObj?.publicLink" class="material-icons-outlined" style="font-size:18px;color:#10b981;cursor:pointer" (click)="UI.openWindow(focusUserLastMessageObj?.publicLink)">link</span>
          </div>
          <span style="color:#10b981;font-size:18px;font-weight:700;">{{UI.convertAndFormatPRNToPRNCurrency(null,focusUserLastMessageObj?.wallet?.balance||0)}}</span>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px; margin-bottom:8px;">
          <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.15); border-radius:8px; padding:8px; font-size:12px; color:#cbd5e1; line-height:1.4;">
            <span *ngIf="focusUserLastMessageObj?.locking?.amountCummulate>1">PRN tokens locked for {{(focusUserLastMessageObj?.locking?.amountCummulate||0)/(focusUserLastMessageObj?.wallet?.balance||1)|number:'1.0-0'}} days</span>
            <span *ngIf="focusUserLastMessageObj?.locking?.amountCummulate<=1">PRN tokens locked for {{(focusUserLastMessageObj?.locking?.amountCummulate||0)/(focusUserLastMessageObj?.wallet?.balance||1)|number:'1.0-0'}} day</span>
          </div>
          <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.15); border-radius:8px; padding:8px; font-size:12px; color:#cbd5e1; line-height:1.4;">
            Earning {{UI.convertAndFormatPRNToPRNCurrency(null,focusUserLastMessageObj?.wallet?.balance*(math.exp((UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0)/365)-1))}} per day
          </div>
        </div>

        <div style="font-size:13px; color:#94a3b8; line-height:1.5; margin-bottom:8px;">
          {{focusUserLastMessageObj?.userPresentation}}
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:10px; font-size:12px; color:#cbd5e1; margin-bottom:8px;">
          <span>Created in {{focusUserLastMessageObj?.createdTimestamp|date:'MMMM yyyy'}}</span>
          <span *ngIf="scope!='all'">Last seen {{formatFocusUserLastSeen()}}</span>
          <span *ngIf="focusUserLastMessageObj?.userChain?.index>1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)>1">{{focusUserLastMessageObj?.userChain?.index}} created messages, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</span>
          <span *ngIf="focusUserLastMessageObj?.userChain?.index>1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)<=1">{{focusUserLastMessageObj?.userChain?.index}} created messages, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} day ago</span>
          <span *ngIf="focusUserLastMessageObj?.userChain?.index<=1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)>1">{{focusUserLastMessageObj?.userChain?.index}} created message, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} days ago</span>
          <span *ngIf="focusUserLastMessageObj?.userChain?.index<=1 && ((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)<=1">{{focusUserLastMessageObj?.userChain?.index}} created message, verified {{((UI.nowSeconds-focusUserLastMessageObj?.verifiedTimestamp?.seconds)/3600/24)|number:'1.2-2'}} day ago</span>
        </div>

        <div style="font-size:12px; color:#cbd5e1; margin-bottom:8px;">
          <span *ngIf="focusUserLastMessageObj?.contract?.signed" style="color:#10b981; font-weight:600;">Level {{focusUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
          <span *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed">Waiting for contract signature (Level {{focusUserLastMessageObj?.contract?.level|number:'1.1-1'}})</span>
          <button class="buttonPrimary" *ngIf="focusUserLastMessageObj?.contract?.createdTimestamp&&!focusUserLastMessageObj?.contract?.signed&&UI.currentUser=='QYm5NATKa6MGD87UpNZCTl6IolX2'" style="margin-left:10px" (click)=signContract()>Sign contract</button>
        </div>
      </div>
    </div>

    <div class="modeSwitchWrap" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; align-items:center;">
      <div class="modeSwitchTrack" style="display:inline-flex; padding:4px; background:rgba(15,23,42,0.75); border:1px solid rgba(16,185,129,0.2); gap:4px; flex-wrap:wrap;">
        <button class="buttonBlack modeSwitchBtn" style="border:none;" [style.background-color]="mode=='inbox'?'#10b981':'transparent'" [style.color]="mode=='inbox'?'#ffffff':'#cbd5e1'" (click)="mode='inbox';refreshMessages()">Inbox</button>
        <button class="buttonBlack modeSwitchBtn" style="border:none;" [style.background-color]="mode=='history'?'#10b981':'transparent'" [style.color]="mode=='history'?'#ffffff':'#cbd5e1'" (click)="mode='history';refreshMessages();refreshChart()">History</button>
        <button class="buttonBlack modeSwitchBtn" style="border:none;" [style.background-color]="mode=='chain'?'#10b981':'transparent'" [style.color]="mode=='chain'?'#ffffff':'#cbd5e1'" (click)="mode='chain';refreshMessages()">Chain</button>
        <button class="buttonBlack modeSwitchBtn" style="border:none;" [style.background-color]="mode=='forecast'?'#10b981':'transparent'" [style.color]="mode=='forecast'?'#ffffff':'#cbd5e1'" (click)="mode='forecast';refreshMessages()">Forecast</button>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px;">
      <button class="buttonBlack" *ngIf="focusUserLastMessageObj?.user==UI.currentUser" style="margin-left:auto; display:inline-flex; align-items:center; gap:6px;" (click)="router.navigate(['settings'])">
        <span class="material-icons" style="font-size:16px;">settings</span>
        Settings
      </button>
    </div>
  </div>
    <div>
      <div *ngIf="mode=='inbox' || scope=='all'" class="splitContainer">
        <div class="profile-events-item">
        <ng-container *ngIf="comingEvents|async as events">
        <ul class="listLight">
          <li *ngIf="events.length===0" style="padding:14px; border: 1px solid rgba(16, 185, 129, 0.1); background: rgba(16, 185, 129, 0.03); color:#94a3b8; font-size:13px;">
            No upcoming events.
          </li>

          <li class="guardedChatItem eventListItem" *ngFor="let message of events; let i = index"
            [style.display]="showAllEvents || i===0 ? 'block' : 'none'"
            (click)="openListedChat(message.payload.doc.data()?.chain, message.payload.doc.data()?.serverTimestamp)">
            <div *ngIf="scope=='all'||mode=='inbox'" class="guardedChatItem eventCardBody">
              <div class="eventCardHeader">
                <div class="eventCardMedia">
                  <ng-container *ngIf="message.payload.doc.data()?.chatProfileImageUrlMedium || message.payload.doc.data()?.chatProfileImageUrlThumb; else eventIconFallback">
                    <img
                      [src]="message.payload.doc.data()?.chatProfileImageUrlMedium || message.payload.doc.data()?.chatProfileImageUrlThumb"
                      class="eventCardChatImage"
                      (error)="UI.handleChatImageError($event, message.payload.doc.data())">
                  </ng-container>
                  <ng-template #eventIconFallback>
                    <span class="material-icons-outlined eventCardIconBadge">event</span>
                  </ng-template>
                  <div class="eventCardTitleBlock">
                    <div class="eventCardLabel">
                      {{i===0 ? 'Next Event' : 'Other Event'}}
                    </div>
                    <div class="chatSubject chatSubjectTruncate">
                      {{message.payload.doc.data()?.chatSubject}}
                    </div>
                  </div>
                </div>
                <button *ngIf="message.payload.doc.data()?.eventLocation"
                  class="buttonPrimary eventCardJoinBtn"
                  [disabled]="!UI.isCurrentUserMember || !isEventLive(message.payload.doc.data()?.eventDateStart, message.payload.doc.data()?.eventDateEnd)"
                  (click)="$event.stopPropagation(); UI.openWindow(message.payload.doc.data()?.eventLocation)">
                  <span>Join</span>
                  <span style="margin-left:5px;font-size:16px;line-height:14px" class="material-icons-outlined" *ngIf="!UI.isCurrentUserMember">lock</span>
                </button>
              </div>

              <div class="eventCardMeta">
                <span *ngIf="math.floor(message.payload.doc.data()?.eventDateStart/60000-UI.nowSeconds/60)>0" class="eventCardStatusChip">
                  In {{UI.formatSecondsToDhm2(message.payload.doc.data()?.eventDateStart/1000-UI.nowSeconds)}}
                </span>
                <span *ngIf="math.floor(message.payload.doc.data()?.eventDateStart/60000-UI.nowSeconds/60)<=0&&message.payload.doc.data()?.eventDateEnd/60000>UI.nowSeconds/60" class="eventCardStatusChip eventCardStatusNow">
                  Live
                </span>
                <span class="eventCardDateText">
                  {{message.payload.doc.data()?.eventDateStart|date:'EEEE d MMM h:mm a'}} ({{message.payload.doc.data()?.eventDuration}}h)
                </span>
              </div>

              <div class="eventCardDescription">
                {{message.payload.doc.data()?.eventDescription}}
              </div>
              <span *ngIf="!UI.isCurrentUserMember" class="material-icons-outlined nonMemberChatLock nonMemberChatLockCorner">lock</span>
            </div>
          </li>
        </ul>
        <button class="buttonBlack eventCardToggleBtn"
          *ngIf="events.length>1 && UI.isCurrentUserMember"
          (click)="showAllEvents=!showAllEvents">
          {{showAllEvents ? 'Hide Other Events' : 'Show More Events'}}
        </button>
        </ng-container>
        </div>

        <div class="profile-funds-item">
      <ul class="listLight">
        <li class="guardedChatItem fundListItem" *ngFor="let message of currentFunds|async;let first=first;let last=last"
          (click)="openListedChat(message.payload.doc.data()?.chain, message.payload.doc.data()?.serverTimestamp)">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div *ngIf="message.payload.doc.data()?.fund?.amountGBPTarget>0">
            <div class="guardedChatItem fundCardBody" style="padding:8px; border-radius: 10px; background: rgba(16, 185, 129, 0.05);">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                <ng-container *ngIf="message.payload.doc.data()?.chatProfileImageUrlMedium || message.payload.doc.data()?.chatProfileImageUrlThumb; else fundIconFallback">
                  <img
                    [src]="message.payload.doc.data()?.chatProfileImageUrlMedium || message.payload.doc.data()?.chatProfileImageUrlThumb"
                    class="eventCardChatImage"
                    (error)="UI.handleChatImageError($event, message.payload.doc.data())">
                </ng-container>
                <ng-template #fundIconFallback>
                  <span class="material-symbols-outlined eventCardIconBadge">crowdsource</span>
                </ng-template>
                <div class="eventCardTitleBlock">
                  <div class="eventCardLabel">{{first ? 'Current Fund' : 'Other Fund'}}</div>
                  <span class="chatSubject chatSubjectTruncate">{{message.payload.doc.data()?.chatSubject}}</span>
                </div>
              </div>

              <div style="background-color:#334155;height:22px;width:92%;margin:0 auto;border-radius:7px;overflow:hidden;position:relative;">
                <div style="height:100%;background: linear-gradient(90deg, #059669 0%, #047857 100%);display:flex;align-items:center;justify-content:center;transition:width 0.3s ease;"
                  [style.width]="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*100+'%'">
                  <span style="font-size: 10px; color: #ffffff; font-weight: 600; white-space: nowrap;" *ngIf="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*100 > 30">
                    {{message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget|percent:'1.0-0'}}
                  </span>
                </div>
              </div>

              <div style="margin-top: 5px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #10b981; font-weight: 500; margin-left: auto;">{{message.payload.doc.data()?.fund?.daysLeft|number:'1.0-0'}} days left</span>
              </div>

              <div style="margin-top: 3px; font-size: 11px; color: #94a3b8; line-height: 1.35;">
                <span>{{message.payload.doc.data()?.fund?.description}}</span>
              </div>

              <div style="margin-top: 3px; font-size: 11px; color: #cbd5e1; line-height: 1.35;">
                target: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPTarget*((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]?.toCOIN||0))}} /
                raised: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPRaised*((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]?.toCOIN||0))}}
              </div>
              <span *ngIf="!UI.isCurrentUserMember" class="material-icons-outlined nonMemberChatLock nonMemberChatLockCorner">lock</span>
            </div>
            </div>
          </div>
        </li>
      </ul>
        </div>

        <div class="island nonMemberIsland profile-banner-item" *ngIf="!UI.isCurrentUserMember">
          <div class="nonMemberIslandIconWrap">
            <span class="material-icons-outlined nonMemberIslandIcon">lock_open</span>
          </div>
          <div class="nonMemberIslandTitle">Unlock Full Access to Team Communications, Media and Features.</div>
          <button class="buttonPrimary nonMemberIslandButton" (click)="router.navigate(['buyPRN'])">Buy PRN Tokens</button>
          <div class="nonMemberIslandFooter">Join the team today.</div>
          <div class="nonMemberIslandHelper">Interested to join but have some questions first? <a href="https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx" target="_blank" rel="noopener noreferrer">Join our WhatsApp community</a> and speak directly to Nico there.</div>
        </div>
      </div>

      <ul *ngIf="mode=='inbox' || scope=='all'" class="listLight imageCarousel" id="scroll-images">
        <li *ngFor="let message of latestImages|async;let first=first;let last=last" class="carouselItem guardedChatItem">
          <div *ngIf="scope=='all'||mode=='inbox'" class="carouselImageWrap" (click)="openCarouselImage(message.payload.doc.data()?.chatImageUrlOriginal)">
            <img [src]="message.payload.doc.data()?.chatImageUrlMedium||message.payload.doc.data()?.chatImageUrlThumb||message.payload.doc.data()?.chatImageUrlOriginal" (error)="UI.handleChatImageError($event, message.payload.doc.data())" class="carouselImage">
          </div>
          <button class="carouselMeta" (click)="openListedChat(message.payload.doc.data()?.chain, message.payload.doc.data()?.serverTimestamp)">
            <span class="messageTiming">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload.doc.data()?.serverTimestamp?.seconds)))}}</span>
          </button>
          <span *ngIf="!UI.isCurrentUserMember" class="material-icons-outlined nonMemberChatLock nonMemberChatLockCorner">lock</span>
        </li>
      </ul>
      <div *ngIf="scope!='all'&& mode=='history'" style="height:400px;margin:10px"><ag-charts-angular [options]="chartOptions"></ag-charts-angular></div>
      <ul *ngIf="mode!='forecast' || scope=='all'" class="listLight">
        <li *ngFor="let message of messages|async;let first=first;let last=last" class="guardedChatItem" style="position:relative;"
          (click)="openListedChat(message.payload.doc.data()?.chain, message.payload.doc.data()?.serverTimestamp)">
          <div *ngIf="scope=='all'||mode=='inbox'">
            <div *ngIf="UI.currentUser && (UI.currentUserLastMessageObj?.createdTimestamp/1000)<message.payload.doc.data()?.serverTimestamp?.seconds && !isMessageSeen(message.payload.doc.data()?.chain,message.payload.doc.data()?.serverTimestamp)"
              style="position:absolute;top:8px;right:8px;width:22px;height:14px;line-height:14px;text-align:center;border-radius:4px;"
              [style.background-color]="(message.payload.doc.data()?.text.includes(UI.currentUserLastMessageObj?.name)) ? '#ef4444' : (message.payload.doc.data()?.recipients[UI.currentUser] ? '#38761D' : '#B0BAC0')">
            </div>
            <div style="float:left;min-width:84px;min-height:40px">
              <img [src]="message.payload.doc.data()?.imageUrlThumbUser" (error)="UI.handleUserImageError($event, message.payload.doc.data())" style="float:left;margin:12px 2px 12px 4px;object-fit:cover;height:40px;width:40px">
              <img *ngIf="message.payload.doc.data()?.recipientList[1]" [src]="message.payload.doc.data()?.recipients[message.payload.doc.data()?.recipientList[1]]?.imageUrlThumb" style="float:left;margin:12px 4px 12px 2px;object-fit:cover;height:25px;width:25px">
            </div>
            <div>
              <div style="float:left;margin-top:10px;width:60%;white-space:nowrap;text-overflow:ellipsis">
                <span class="chatSubject chatSubjectStrong">{{message.payload.doc.data()?.chatSubject}}{{message.payload.doc.data()?.recipientList.length>1?' ('+message.payload.doc.data()?.recipientList.length+')':''}}</span>
              </div>
              <div class="messageTiming" style="float:right;margin-top:10px;margin-right:36px;width:40px">{{UI.formatSecondsToDhm1(math.max(0,(UI.nowSeconds-message.payload.doc.data()?.serverTimestamp?.seconds)))}}</div>
              <div style="clear:both;float:left;margin-bottom:10px;width:90%;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
                <span class="messageAuthor">{{message.payload.doc.data()?.name}}:&nbsp;</span>
                <span *ngIf="message.payload.doc.data()?.imageResized" class="messageImageBadge">
                  <span class="material-icons-outlined" style="font-size:14px;line-height:1">photo</span>
                </span>
                <span>{{message.payload.doc.data()?.automaticMessage?"(Automatic) ":""}}{{message.payload.doc.data()?.text}}</span>
              </div>
            </div>
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
                <th class="th-date">
                  <span class="dateFull">{{(message.payload.doc.data()?.verifiedTimestamp?.seconds*1000)|date:'d MMM yyyy'}}</span>
                  <span class="dateShort">{{(message.payload.doc.data()?.verifiedTimestamp?.seconds*1000)|date:'d MMM yy'}}</span>
                </th>
                <th class="th-days">{{first?'':(message.payload.doc.data()?.verifiedTimestamp?.seconds-previousTimestamp.seconds)/3600/24|number:'1.2-2'}}</th>
                <th class="th-messages">{{first?'':(message.payload.doc.data()?.userChain?.index-previousIndex)}}</th>
                <th class="th-balance">{{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.wallet?.balance)}}</th>
                <th class="th-change">{{first?'':UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.wallet?.balance-previousBalance)}}</th>
                <th class="th-purchase">{{first?'':UI.convertAndFormatPRNToCurrency(null,(message.payload.doc.data()?.purchaseCOIN?.amountCummulate||0)-previousPurchaseCOINAmountCummulate)|blankIfZero}}</th>
                <th class="th-transaction">{{first?'':UI.convertAndFormatPRNToCurrency(null,(message.payload.doc.data()?.transactionIn?.amountCummulate||0)-(message.payload.doc.data()?.transactionOut?.amountCummulate||0)-previousAmountTransactionCummulate)|blankIfZero}}</th>
                <th class="th-interest">{{first?'':UI.convertAndFormatPRNToCurrency(null,(message.payload.doc.data()?.interest?.amountCummulate||0)-previousAmountInterestCummulate)|blankIfZero}}</th>
                <th class="th-contract">{{first?'':UI.convertAndFormatPRNToCurrency(null,(message.payload.doc.data()?.contract?.amountCummulate||0)-previousContractAmountCummulate)|blankIfZero}}</th>
                <th class="th-message">{{message.payload.doc.data()?.userChain?.currentMessage}}</th>
              </tr>
              {{storeMessageValues(message.payload.doc.data())}}
            </table>
            <span *ngIf="!UI.isCurrentUserMember" class="material-icons-outlined nonMemberChatLock nonMemberChatLockCorner">lock</span>
        </li>
      </ul>
      <div *ngIf="scope!='all'&& mode=='forecast'">
        <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">Year</div>
        <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">Growth</div>
        <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">Balance</div>
        <div style="float:left;text-align:center;width:65px;height:20px;font-size:10px">Multiple</div>
        <div class="tableRow" style="clear:both">
          <ul>
            <li *ngFor="let number of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]" style="clear:both">
              <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">{{number}}</div>
              <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">{{(UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0) | percent : "0.0"}}</div>
              <div style="float:left;text-align:center;width:75px;height:20px;font-size:10px">
                {{UI.convertAndFormatPRNToCurrency(null,focusUserLastMessageObj?.wallet?.balance*math.exp((UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0)*number))}}
              </div>
              <div style="float:left;text-align:center;width:65px;height:20px;font-size:10px">{{math.exp((UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0)*number)|number:'1.1-1'}}x</div>
            </li>
          </ul>
        </div>
      </div>
      <div class="spinner" *ngIf="UI.loading">
        <div class="bounce1"></div>
        <div class="bounce2"></div>
        <div class="bounce3"></div>
      </div>
      <div class="island" *ngIf="UI.isCurrentUserMember">
        <button class="buttonPrimary" *ngIf="(!UI.loading && !['forecast', 'history'].includes(mode)) || scope=='all'" style="width:200px;margin:10px auto" (click)="loadMore()">Load more</button>
      </div>
    </div>
  </div>
  </div>
  `
})
export class ProfileComponent {
  messages:Observable<any[]>
  comingEvents:Observable<any[]>
  currentFunds:Observable<any[]>
  latestImages:Observable<any[]>
  scrollTeam:string
  focusUserLastMessageObj:any
  lastSeenByChain:any
  lastSeenSubscription: Subscription | null = null;
  focusUserLastSeenSubscription: Subscription | null = null;
  authSubscription: Subscription | null = null;
  currentUserId: string | null = null;
  focusUserLastSeenTimestampMessage:number
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
  showAllEvents:boolean
  chartOptions:AgChartOptions

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService,
    private route:ActivatedRoute,
    private cd: ChangeDetectorRef
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
    this.route.params.subscribe(params => {
      this.forceScrollTop();
      this.scope=params.id
      afs.collection<any>('PERRINNMessages',ref=>ref
        .where('user','==',this.scope)
        .where('verified','==',true)
        .orderBy('serverTimestamp','desc').limit(1)
      ).valueChanges().subscribe(snapshot=>{
        this.focusUserLastMessageObj=snapshot[0]
      })
      this.subscribeToFocusUserLastSeen();
      this.refreshMessages()
      this.subscribeToLastSeen();
    })
  }

  ngOnInit() {
    this.forceScrollTop();
    setTimeout(() => {
      this.forceScrollTop();
      this.cd.detectChanges()
    }, 10)
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
        return changes.map(c=>({payload:c.payload}))
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
      }))
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
      }))
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
      const mapByChain = {};
      snaps.forEach(snap => {
        const data = snap.payload.doc.data() || {};
        const timestampMessage = this.toMillis(data['serverTimestamp']);
        if (timestampMessage > 0) mapByChain[snap.payload.doc.id] = timestampMessage;
      });
      this.lastSeenByChain = mapByChain;
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


  newMessageToUser() {
    let ID=this.UI.newId()
    this.UI.createMessage({
      text:'General - Starting a new chat.',
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

  openListedChat(chain: string, messageTimestamp?: any) {
    if (!this.UI.isCurrentUserMember || !chain) return;
    // readFlagClick removed: lastSeen is now updated only on reload/refresh
    this.router.navigate(['chat', chain]);
  }

  isEventLive(eventDateStart: any, eventDateEnd: any): boolean {
    const start = Number(eventDateStart || 0)
    const end = Number(eventDateEnd || 0)
    const now = this.UI.nowSeconds * 1000
    return start <= now && end > now
  }

  openCarouselImage(imageUrl: string) {
    if (!this.UI.isCurrentUserMember || !imageUrl) return
    this.UI.showFullScreenImage(imageUrl)
  }

  loadMore() {
    this.messageNumberDisplay+=15
    this.refreshMessages()
  }

}
