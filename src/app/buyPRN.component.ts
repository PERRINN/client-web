import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, Subject, interval } from "rxjs";
import { map, takeUntil } from "rxjs/operators";
import { Router, ActivatedRoute } from "@angular/router";
import { UserInterfaceService } from "./userInterface.service";
import { AngularFirestore } from "@angular/fire/compat/firestore";
import { AngularFireAuth } from "@angular/fire/compat/auth";
import { environment } from "../environments/environment";
import { AgChartOptions } from "ag-charts-community";
import { firstValueFrom } from "rxjs";

interface RevolutOrderResponse {
  checkout_url?: string;
  id?: string;
}

type PaymentState =
  | "idle"
  | "creating-order"
  | "checkout-opened"
  | "awaiting-payment"
  | "payment-received"
  | "crediting"
  | "completed"
  | "failed";


@Component({
  selector: "buyPRN",
  template: `
  <div class="buyWrap">
    <div class="buyPage">
    <div style="display:flex; width:100%; margin-bottom:10px;">
      <button class="buttonSecondary" style="margin-left:auto;padding:6px 10px;font-size:11px;font-weight:600;opacity:0.78;background:rgba(15,23,42,0.45);border-color:rgba(148,163,184,0.28);color:#94a3b8;" (click)="openPrnInfoPopup()">What is PRN</button>
    </div>
    <div *ngIf="transactionPendingMessageObj" class="island" style="background: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.1); margin-bottom: 20px;">
      <div *ngIf="!transactionPendingMessageObj?.transactionPending?.activated">
        <div style="font-size: 16px; font-weight: 600; color: #f1f5f9; margin-bottom: 16px;">
          Pending Transaction
        </div>
        <div style="padding:12px;text-align:center">
          <span style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">{{transactionPendingMessageObj.name}} is sending you {{UI.convertAndFormatPRNToPRNCurrency(currencySelected,transactionPendingMessageObj.transactionPending.amount||0)}} (Reference: {{transactionPendingMessageObj.transactionPending.reference}}).</span>
          <button *ngIf="!UI.currentUser" class="buttonPrimary" style="margin:12px auto;width:150px;font-size:12px;padding:10px;" (click)="router.navigate(['login'])" [disabled]='this.router.url.startsWith("/login")'>Login</button>
          <button *ngIf="UI.currentUser&&!UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonPrimary" style="margin:12px auto;width:200px;font-size:12px;padding:10px;" (click)="router.navigate(['settings'])">Update Profile Picture</button>
          <button *ngIf="UI.currentUser&&UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonPrimary" style="margin:12px auto;width:150px;font-size:12px;padding:10px;" (click)="activateTransactionPending(transactionPendingMessage)">Activate</button>
        </div>
      </div>
      <div *ngIf="transactionPendingMessageObj?.transactionPending?.activated">
        <div style="font-size: 14px; color: #10b981; font-weight: 600;">
          ✓ Transaction Already Activated
        </div>
      </div>
    </div>
    <br/>
    <div *ngIf="!UI.isCurrentUserMember" class="island" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(5, 150, 105, 0.2);">
      <div style="font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 16px;">
        🔑 Unlock Your Membership
      </div>
      <div style="padding:0;text-align:center">
        <div style="font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 14px; word-break: break-word; overflow-wrap: break-word;">
          {{UI.convertAndRoundUpAndFormatPRNToCurrency(currencySelected,UI.PERRINNAdminLastMessageObj?.membership?.amountRequired)}}
        </div>
        <span style="font-size: 13px; line-height: 1.7; color: rgba(255, 255, 255, 0.95); display: block;">
          <strong>One-time investment.</strong> No subscriptions. No recurring charges.
        </span>
        <br />
        <div style="background-color: rgba(255, 255, 255, 0.12); padding: 12px; border-radius: 10px; margin: 12px 0;">
          <span style="font-size: 12px; line-height: 1.7; color: #ffffff; display: block; text-align: left;">
            ✓ Lifetime membership<br/>
            ✓ Ownership stake in PERRINN<br/>
            ✓ {{(UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0) | percent : "0.0"}} annual growth<br/>
            ✓ Early member advantage
          </span>
        </div>
        <div style="font-size: 12px; line-height: 1.45; color: rgba(255, 255, 255, 0.92); margin-top: 10px; text-align: left;">
          Interested to join but have some questions first? <a href="https://chat.whatsapp.com/CzUNIrzBBuiI6lOCnh9DRx" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; font-weight: 700;">Join our WhatsApp community</a> and speak directly to Nico there.
        </div>
      </div>
    </div>
    <div *ngIf="UI.isCurrentUserMember" class="island" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 24px; border-radius: 12px; box-shadow: 0 10px 30px rgba(5, 150, 105, 0.2);">
      <div style="font-size: 18px; font-weight: 700; color: #ffffff; margin-bottom: 16px;">
        ✅ Membership Active
      </div>
      <div style="padding:0;text-align:center">
        <div style="font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 14px; word-break: break-word; overflow-wrap: break-word;">
          {{UI.convertAndFormatPRNToPRNCurrency(currencySelected, UI.currentUserLastMessageObj?.wallet?.balance || 0)}}
        </div>
        <div style="background-color: rgba(255, 255, 255, 0.12); padding: 12px; border-radius: 10px; margin: 12px 0;">
          <span style="font-size: 12px; line-height: 1.7; color: #ffffff; display: block; text-align: left;">
            ✓ Lifetime membership<br/>
            ✓ {{(UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0) | percent : "0.0"}} annual growth<br/>
            ✓ Voting rights & governance<br/>
            ✓ Exclusive network access
          </span>
        </div>
      </div>
    </div>
    <br/>

    <div class="island" style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.1);">
      <div style="font-size: 16px; font-weight: 700; color: #f1f5f9; margin-bottom: 16px;">
        Funding Projects
      </div>
      <div style="padding:0px;text-align:left; margin-bottom: 16px;">
        <span style="font-size: 13px; color: #94a3b8; line-height: 1.6; display: block;">
          All capital is transparently allocated to active PERRINN initiatives
        </span>
      </div>
      <ul class="listLight">
        <li *ngFor="let message of currentFunds|async" style="padding:0px">
          <div *ngIf="message.payload.doc.data()?.fund?.amountGBPTarget>0&&(message.payload.doc.data()?.fund?.active||showPastFunds)" style="cursor:default;padding:12px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.1); margin-bottom: 10px; background: rgba(16, 185, 129, 0.03);">
            <span class="chatSubject">{{message.payload.doc.data()?.chatSubject}}</span>
            <div style="margin-top: 10px;">
              <div style="background-color:#334155;height:24px;width:100%;border-radius:6px;overflow:hidden;position:relative;">
                <div style="height:100%;background: linear-gradient(90deg, #059669 0%, #047857 100%);display:flex;align-items:center;justify-content:center;transition:width 0.3s ease;"
                  [style.width]="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*100+'%'">
                  <span style="font-size: 11px; color: #ffffff; font-weight: 600; white-space: nowrap;" *ngIf="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*100 > 30">
                    {{message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget|percent:"1.0-0"}}
                  </span>
                </div>
              </div>
              <div style="margin-top: 8px; font-size: 12px; color: #94a3b8; display: flex; justify-content: space-between; align-items: center;">
                <span>
                  <span *ngIf="message.payload.doc.data()?.fund?.active" style="color: #10b981; font-weight: 500;">{{message.payload.doc.data()?.fund?.daysLeft|number:"1.0-0"}} days left</span>
                  <span *ngIf="!message.payload.doc.data()?.fund?.active" style="color: #94a3b8;">{{-message.payload.doc.data()?.fund?.daysLeft|number:"1.0-0"}} days ago</span>
                </span>
              </div>
              <div style="margin-top: 4px; font-size: 11px; color: #cbd5e1; line-height: 1.35;">
                target: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPTarget*((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]?.toCOIN||0))}} /
                raised: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPRaised*((UI.PERRINNAdminLastMessageObj?.currencyList||{})["gbp"]?.toCOIN||0))}}
              </div>
            </div>
          </div>
        </li>
      </ul>
      <button class="buttonSecondary" style="margin:16px auto;padding:10px 20px;font-size:12px;font-weight:600;width:auto;" (click)="showPastFunds=!showPastFunds">
        {{showPastFunds ? 'Hide Past Funds' : 'Show Past Funds'}}
      </button>
    </div>
    <br/>
    <div class="island" style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.1);">
      <div style="display: flex; align-items: center; margin-bottom: 20px;">
        <span class="material-symbols-outlined" style="font-size: 24px; color: #10b981; margin-right: 12px;">payment</span>
        <div style="font-size: 16px; font-weight: 700; color: #f1f5f9;">
          Secure Payment
        </div>
      </div>
      
      <div style="padding: 12px 14px; background-color: rgba(16, 185, 129, 0.08); border-radius: 10px; border-left: 3px solid #10b981; margin-bottom: 24px;">
        <span style="font-size: 12px; color: #94a3b8; display: flex; align-items: center; font-weight: 500;">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 8px; color: #10b981;">shield_lock</span>
          Powered by Revolut
        </span>
      </div>

      <div *ngIf="UI.currentUser" style="padding: 0; margin-bottom: 24px;">
        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
          Currency
        </div>
        <ul class="listLight currency-selector-list">
          <li style="flex: 1; min-width: 120px;" *ngFor="let currency of objectToArray(UI.PERRINNAdminLastMessageObj?.currencyList)">
            <button class="buttonToggle"
              (click)="onCurrencySelected(currency[0])"
              style="width:100%;padding: 10px; border-radius: 8px; border: 2px solid; transition: all 0.3s ease; font-weight: 600; font-size: 13px;"
              [style.background-color]="currencySelected == currency[0] ? '#10b981' : 'transparent'"
              [style.border-color]="currencySelected == currency[0] ? '#10b981' : 'rgba(16, 185, 129, 0.2)'"
              [style.color]="currencySelected == currency[0] ? '#ffffff' : '#cbd5e1'"
            >
              {{ currency[1].designation }}
            </button>
          </li>
        </ul>
      </div>

      <div *ngIf="UI.currentUser" style="padding: 0;">
        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
          Amount
        </div>
        <ul class="listLight" style="display: flex; flex-wrap: wrap; gap: 10px;">
          <li style="flex: 0 1 auto;" *ngFor="let credit of creditList; let index = index">
            <button class="buttonToggle"
              (click)="creditSelected = index; refreshAmountCharge()"
              style="padding: 10px 16px; border-radius: 8px; border: 2px solid; transition: all 0.3s ease; font-weight: 600; font-size: 12px; white-space: nowrap;"
              [style.background-color]="creditSelected == index ? '#10b981' : 'transparent'"
              [style.border-color]="creditSelected == index ? '#10b981' : 'rgba(16, 185, 129, 0.2)'"
              [style.color]="creditSelected == index ? '#ffffff' : '#cbd5e1'"
            >
            {{UI.formatCurrency(currencySelected,credit)}}
            </button>
          </li>
        </ul>
        <br />
        <div *ngIf="creditSelected!=undefined&&currencySelected!=undefined" style="text-align:center; padding: 16px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.05) 100%); border-radius: 10px; margin-top: 16px; border: 1px solid rgba(16, 185, 129, 0.2);">
          <span style="color: #cbd5e1; font-size: 13px; display: block; margin-bottom: 8px;">
            You will pay
          </span>
          <span style="color: #10b981; font-size: 18px; font-weight: 700; display: block; margin-bottom: 12px;">{{UI.formatCurrency(currencySelected,creditList[creditSelected])}}</span>
          <div style="height: 1px; background: rgba(16, 185, 129, 0.1); margin: 12px 0;"></div>
          <span style="color: #94a3b8; font-size: 12px; display: block; margin-bottom: 4px; margin-top: 12px;">
            you will receive
          </span>
          <span style="color: #10b981; font-size: 16px; font-weight: 700;">{{UI.formatPRNCurrency(currencySelected,creditList[creditSelected])}}</span>
        </div>
      </div>

            <button class="buttonPrimary" *ngIf="UI.currentUser && !processing && creditSelected!=undefined && currencySelected!=undefined"
              (click)="payWithRevolutLink()"
              [disabled]="isPaymentFlowLocked"
              style="width:100%; margin:24px 0 0 0; font-size:14px; line-height: 1.6; padding: 14px 16px; font-weight: 700; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);">
        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 8px;">arrow_forward</span>
        Proceed to Checkout
      </button>

          <button class="buttonPrimary" *ngIf="!UI.currentUser"
              (click)="router.navigate(['login'], {queryParams: {returnUrl: '/buyPRN'}})"
              style="width:100%; margin:24px 0 0 0; font-size:14px; line-height: 1.6; padding: 14px 16px; font-weight: 700; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);">
            <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 8px;">login</span>
            Log in to Buy PRN Tokens
          </button>

            <div *ngIf="paymentState !== 'idle'" style="background: #1e293b; padding: 18px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.22); margin-top: 16px; text-align: left;">
              <div style="font-size: 15px; font-weight: 700; color: #f1f5f9; margin-bottom: 8px;">Payment status</div>
              <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 10px; line-height: 1.45;">{{paymentStatusText}}</div>

              <div style="display:grid; gap:6px;">
                <div style="font-size:12px; color:#94a3b8;">
                  <span [style.color]="paymentStepOrderCreated ? '#10b981' : '#64748b'">{{paymentStepOrderCreated ? '✓' : '•'}}</span>
                  Order created
                </div>
                <div style="font-size:12px; color:#94a3b8;">
                  <span [style.color]="paymentStepCheckoutOpened ? '#10b981' : '#64748b'">{{paymentStepCheckoutOpened ? '✓' : '•'}}</span>
                  Checkout opened
                </div>
                <div style="font-size:12px; color:#94a3b8;">
                  <span [style.color]="paymentStepPaymentReceived ? '#10b981' : '#64748b'">{{paymentStepPaymentReceived ? '✓' : '•'}}</span>
                  Payment received by Revolut
                </div>
                <div style="font-size:12px; color:#94a3b8;">
                  <span [style.color]="paymentStepMessageGenerated ? '#10b981' : '#64748b'">{{paymentStepMessageGenerated ? '✓' : '•'}}</span>
                  PERRINN message generated
                </div>
                <div style="font-size:12px; color:#94a3b8;">
                  <span [style.color]="paymentStepCredited ? '#10b981' : '#64748b'">{{paymentStepCredited ? '✓' : '•'}}</span>
                  PRN credited to wallet
                </div>
              </div>

              <div style="margin-top:10px;font-size:11px;color:#94a3b8;line-height:1.4;">
                Revolut sends the payment receipt email directly after successful capture.
              </div>
              <button
                class="buttonSecondary"
                *ngIf="paymentState !== 'creating-order'"
                (click)="resetPaymentFlow()"
                style="margin-top:10px;padding:7px 12px;font-size:11px;">
                Reset payment status
              </button>
            </div>
    </div>

          <div *ngIf="showPrnInfoPopup" style="position:fixed;inset:0;background:rgba(2,8,23,0.72);z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;" (click)="closePrnInfoPopup()">
            <div class="island" style="background: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.16); width:min(560px, 88vw); max-height:calc(100vh - 24px); overflow:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;" (click)="$event.stopPropagation()">
              <div style="display:flex;justify-content:flex-start;align-items:center;margin-bottom:12px;">
                <div style="font-size:16px;font-weight:700;color:#f1f5f9;">What is PRN</div>
              </div>
              <div style="text-align:center; margin-bottom: 20px;">
                <img src="./../assets/App icons/PRN token.png" style="width:120px; opacity: 0.95;">
              </div>
              <div style="padding:0 4px 6px 4px; text-align:left;">
                <div style="font-size:12px; color:#94a3b8; margin-bottom:8px; font-weight:600; text-transform:uppercase; letter-spacing:1px;">Why PRN exists</div>
                <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; padding: 12px; margin-bottom: 8px; color:#cbd5e1; line-height:1.5; font-size:13px;">
                  PRN is not a traditional crypto token that fluctuates in open public markets. It is not a speculative asset.
                </div>
                <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.16); border-radius: 10px; padding: 12px; margin-bottom: 8px; color:#cbd5e1; line-height:1.5; font-size:13px;">
                  PRN is a digital asset secured directly by the PERRINN network and designed for team collaboration.
                </div>
                <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.16); border-radius: 10px; padding: 12px; margin-bottom: 8px; color:#cbd5e1; line-height:1.5; font-size:13px;">
                  PRN tokens can only be transferred member-to-member inside the PERRINN team and ecosystem.
                </div>
                <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; padding: 12px; color:#e2e8f0; line-height:1.5; font-size:13px; font-weight:600;">
                  PRN is a true membership token. Its utility is to build trust among members and provide a shared unit of exchange in the team.
                </div>
                <div style="margin-top:10px; padding:12px; border-radius:10px; border:1px solid rgba(16,185,129,0.24); background: linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.08) 100%); color:#ecfeff; font-size:13px; line-height:1.5; font-weight:700; text-align:center;">
                  PRN represents ownership of PERRINN.
                </div>
              </div>
              <div style="padding:0;text-align:center; margin-bottom: 20px;">
                <div style="padding:16px;text-align:left;">
                  <div style="font-size: 11px; color: #94a3b8; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                    Overview
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="background-color: rgba(16, 185, 129, 0.08); padding: 14px; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.2);">
                      <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px; font-weight: 500;">MEMBERS</div>
                      <div style="font-size: 18px; font-weight: 700; color: #10b981;">{{UI.PERRINNAdminLastMessageObj?.statistics?.membersCount}}</div>
                    </div>
                    <div style="background-color: rgba(16, 185, 129, 0.08); padding: 14px; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.2);">
                      <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px; font-weight: 500;">TOTAL SUPPLY</div>
                      <div style="font-size: 18px; font-weight: 700; color: #10b981;">{{UI.convertAndFormatPRNToPRNCurrency(currencySelected,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}</div>
                    </div>
                  </div>
                </div>
                <button class="buttonSecondary" style="margin:16px auto;padding:10px 20px;font-size:12px;font-weight:600;" (click)="router.navigate(['directory']); closePrnInfoPopup()">PRN Directory</button>
              </div>
              <div style="background-color: rgba(16, 185, 129, 0.05);padding:16px;text-align:center; border-radius: 10px; margin-top: 16px;">
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px; font-weight: 500;">Growth Rate</div>
                <span style="color: #f1f5f9; font-weight: 600;">{{(UI.PERRINNAdminLastMessageObj?.interest?.rateYear||0) | percent : "0.0"}} Annual</span>
                <div style="height:200px;margin-top:12px"><ag-charts-angular [options]="chartOptions"></ag-charts-angular></div>
              </div>
              <div style="padding:16px;text-align:center; margin-top: 16px; border-top: 1px solid rgba(16, 185, 129, 0.1);">
                <span class="material-symbols-outlined" style="font-size:24px; color: #10b981; margin-bottom: 8px; display: block;">lock</span>
                <span style="font-size: 13px; color: #94a3b8; line-height: 1.6; display: block;">
                  Tokens stored securely in your PERRINN wallet
                </span>
              </div>
              <div style="display:flex;justify-content:center;margin-top:14px;">
                <button class="buttonSecondary" style="padding:7px 14px;font-size:11px;" (click)="closePrnInfoPopup()">Close</button>
              </div>
            </div>
          </div>
  </div>
`
})
export class buyPRNComponent implements OnInit, OnDestroy {
  transactionPendingMessage: string;
  transactionPendingMessageObj: any;
  amountSharesPurchased: number;
  amountCharge: number;
  currencySelected: string;
  creditListPRN: number[];
  creditList: number[];
  creditSelected: number;
  processing = false;
  showPastFunds = false;
  currentFunds: Observable<any[]>;
  chartOptions: AgChartOptions;
  paymentState: PaymentState = "idle";
  paymentStatusText = "";
  paymentOrderId: string = null;
  paymentReference: string = null;
  paymentStepOrderCreated = false;
  paymentStepCheckoutOpened = false;
  paymentStepPaymentReceived = false;
  paymentStepMessageGenerated = false;
  paymentStepCredited = false;
  showPrnInfoPopup = false;
  private paymentTrackingVersion = 0;
  private paymentSyncInFlight = false;
  private hasUserManuallySelectedCurrency = false;
  private lastCreditsBase = 0;
  private lastSyncedCurrency = "";
  private previousMainContainerOverflow = "";
  private previousBodyOverflow = "";
  
  private destroy$ = new Subject<void>();
  
  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private route: ActivatedRoute,
    private http: HttpClient
  ) {
    this.currencySelected =
      UI.currentUserLastMessageObj?.userCurrency || "usd";
  }

  ngOnInit(): void {
    this.setupTransactionListener();
    this.setupCurrentFunds();
    this.chartOptions = this.buildChartOptions();
    this.syncCurrencyAndCredits();
    interval(600)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.syncCurrencyAndCredits());
    this.restorePendingPaymentFromLocalCache();
  }

  ngOnDestroy(): void {
    this.unlockBackgroundScroll();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private lockBackgroundScroll(): void {
    const mainContainer = document.getElementById("main_container");
    if (mainContainer) {
      this.previousMainContainerOverflow = mainContainer.style.overflowY || "";
      mainContainer.style.overflowY = "hidden";
    }
    this.previousBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  }

  private unlockBackgroundScroll(): void {
    const mainContainer = document.getElementById("main_container");
    if (mainContainer) {
      mainContainer.style.overflowY = this.previousMainContainerOverflow || "";
    }
    document.body.style.overflow = this.previousBodyOverflow || "";
  }

  openPrnInfoPopup(): void {
    this.showPrnInfoPopup = true;
    this.lockBackgroundScroll();
  }

  closePrnInfoPopup(): void {
    this.showPrnInfoPopup = false;
    this.unlockBackgroundScroll();
  }

  get isPaymentFlowLocked(): boolean {
    return (
      this.paymentState === "creating-order" ||
      this.paymentState === "checkout-opened" ||
      this.paymentState === "awaiting-payment" ||
      this.paymentState === "payment-received" ||
      this.paymentState === "crediting"
    );
  }

  private setPaymentState(state: PaymentState, text: string): void {
    this.paymentState = state;
    this.paymentStatusText = text;
  }

  private storePendingPaymentLocalCache(): void {
    if (!this.paymentOrderId || !this.paymentReference) return;
    localStorage.setItem(
      "buyPRN_pendingPayment",
      JSON.stringify({
        orderId: this.paymentOrderId,
        reference: this.paymentReference,
        timestamp: Date.now(),
      })
    );
  }

  private restorePendingPaymentFromLocalCache(): void {
    const raw = localStorage.getItem("buyPRN_pendingPayment");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.orderId || !parsed?.reference) return;
      this.paymentOrderId = parsed.orderId;
      this.paymentReference = parsed.reference;
      this.paymentStepOrderCreated = true;
      this.paymentStepCheckoutOpened = true;
      this.setPaymentState("awaiting-payment", "Waiting for Revolut payment confirmation...");
      this.startPaymentTracking();
    } catch (e) {
      localStorage.removeItem("buyPRN_pendingPayment");
    }
  }

  private clearPendingPaymentLocalCache(): void {
    localStorage.removeItem("buyPRN_pendingPayment");
  }

  private isPaymentSuccessStatus(status: any): boolean {
    const value = String(status || "").toLowerCase();
    return ["succeeded", "completed", "paid", "captured", "authorised", "authorized"].includes(value);
  }

  private isPaymentFailureStatus(status: any): boolean {
    const value = String(status || "").toLowerCase();
    return ["failed", "cancelled", "canceled", "declined"].includes(value);
  }

  private async syncPaymentStatusFromRevolut(): Promise<void> {
    if (this.paymentSyncInFlight) return;
    if (!this.UI.currentUser || !this.paymentOrderId) return;
    if (!(this.paymentState === "awaiting-payment" || this.paymentState === "payment-received" || this.paymentState === "crediting")) return;

    this.paymentSyncInFlight = true;
    try {
      await firstValueFrom(
        this.http.post<any>(
          "https://us-central1-perrinn-d5fc1.cloudfunctions.net/syncRevolutOrderStatus",
          {
            orderId: this.paymentOrderId,
            mode: this.UI.revolutMode === "prod" ? "prod" : "sandbox",
            user: this.UI.currentUser,
            reference: this.paymentReference,
          }
        )
      );
    } catch (err) {
      console.warn("syncPaymentStatusFromRevolut failed", err);
    } finally {
      this.paymentSyncInFlight = false;
    }
  }

  resetPaymentFlow(): void {
    this.paymentTrackingVersion++;
    this.processing = false;
    this.paymentOrderId = null;
    this.paymentReference = null;
    this.paymentStepOrderCreated = false;
    this.paymentStepCheckoutOpened = false;
    this.paymentStepPaymentReceived = false;
    this.paymentStepMessageGenerated = false;
    this.paymentStepCredited = false;
    this.setPaymentState("idle", "");
    this.clearPendingPaymentLocalCache();
  }

  private startPaymentTracking(): void {
    if (!this.UI.currentUser || !this.paymentOrderId) return;
    const version = ++this.paymentTrackingVersion;

    this.afs
      .doc<any>(`PERRINNTeams/${this.UI.currentUser}/payments/${this.paymentOrderId}`)
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((paymentDoc) => {
        if (version !== this.paymentTrackingVersion || !paymentDoc) return;
        const status = (paymentDoc.source || paymentDoc).status || paymentDoc.status;

        if (this.isPaymentSuccessStatus(status)) {
          this.paymentStepPaymentReceived = true;
          this.setPaymentState("payment-received", "Payment received by Revolut. Finalizing credit...");
        }

        if (this.isPaymentFailureStatus(status)) {
          this.setPaymentState("failed", "Payment failed or was cancelled. You can try again.");
          this.clearPendingPaymentLocalCache();
          this.paymentTrackingVersion++;
        }
      });

    interval(7000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (version !== this.paymentTrackingVersion) return;
        this.syncPaymentStatusFromRevolut();
      });

    this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("user", "==", this.UI.currentUser)
          .where("verified", "==", true)
          .orderBy("serverTimestamp", "desc")
          .limit(40)
      )
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((messages) => {
        if (version !== this.paymentTrackingVersion || !Array.isArray(messages)) return;
        const matchingCredit = messages.find(
          (message) => ((message.purchaseCOIN || {}).chargeID || null) === this.paymentOrderId
        );
        if (!matchingCredit) return;

        this.paymentStepMessageGenerated = true;
        this.setPaymentState("crediting", "PERRINN message generated. Crediting PRN wallet...");

        setTimeout(() => {
          if (version !== this.paymentTrackingVersion) return;
          this.paymentStepCredited = true;
          this.setPaymentState("completed", "Payment successful. PRN tokens are now credited.");
          this.clearPendingPaymentLocalCache();
          this.paymentTrackingVersion++;
        }, 300);
      });
  }

  private setupTransactionListener(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.transactionPendingMessage = params.id;
      this.afs
        .doc<any>(`PERRINNMessages/${params.id}`)
        .valueChanges()
        .pipe(takeUntil(this.destroy$))
        .subscribe(
          (document) => {
            this.transactionPendingMessageObj = document || null;
            if (!document) console.log("No document found with the given ID.");
          },
          (error) => console.error("Error retrieving document:", error)
        );
    });
  }

  private setupCurrentFunds(): void {
    this.currentFunds = this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("lastMessage", "==", true)
          .where("verified", "==", true)
          .orderBy("fund.daysLeft", "desc")
      )
      .snapshotChanges()
      .pipe(
        map((changes) => changes.map((c) => ({ payload: c.payload }))),
        takeUntil(this.destroy$)
      );
  }

  private buildChartOptions(): AgChartOptions {
    const now = this.UI.nowSeconds * 1000;
    const start = 1296578670000;
    const yearMs = 365 * 24 * 3600000;
    const scale = 0.1 / (365 * 24 * 3600);

    const calcPrice = (time: number) =>
      Math.exp(((time - start) / 1000) * scale);

    return {
      title: { text: "PRN growth" },
      data: [
        { year: start, price: 1 },
        { year: now - 6 * yearMs, price: calcPrice(now - 6 * yearMs) },
        { year: now, price: calcPrice(now) },
        { year: now + 6 * yearMs, price: calcPrice(now + 6 * yearMs) },
      ],
      series: [{ type: "line", xKey: "year", yKey: "price" }],
      theme: "ag-default-dark",
      axes: [
        { type: "time", position: "bottom" },
        { type: "number", position: "left", keys: ["price"] },
      ],
    };
  }

  private buildCreditList(base?: number): number[] {
    const amountRequired = Number((base ?? this.UI.PERRINNAdminLastMessageObj?.membership?.amountRequired) || 0);
    if (!amountRequired || amountRequired <= 0) return [];
    const amounts = [amountRequired, amountRequired * 2, amountRequired * 4, amountRequired * 10, amountRequired * 20];
    return this.UI.isDev ? [1, ...amounts] : amounts;
  }

  private syncCurrencyAndCredits(): void {
    const currencyList = this.UI.PERRINNAdminLastMessageObj?.currencyList || {};
    const preferredCurrency = this.UI.currentUserLastMessageObj?.userCurrency;

    if (
      !this.hasUserManuallySelectedCurrency &&
      preferredCurrency &&
      currencyList[preferredCurrency] &&
      this.currencySelected !== preferredCurrency
    ) {
      this.currencySelected = preferredCurrency;
    }

    if (!this.currencySelected || !currencyList[this.currencySelected]) {
      const fallbackCurrency = preferredCurrency && currencyList[preferredCurrency]
        ? preferredCurrency
        : (currencyList["usd"] ? "usd" : Object.keys(currencyList)[0]);
      if (fallbackCurrency) this.currencySelected = fallbackCurrency;
    }

    const creditsBase = Number(this.UI.PERRINNAdminLastMessageObj?.membership?.amountRequired || 0);
    if (!creditsBase || creditsBase <= 0) return;

    if (this.lastCreditsBase !== creditsBase || !this.creditListPRN?.length) {
      this.lastCreditsBase = creditsBase;
      this.creditListPRN = this.buildCreditList(creditsBase);
    }

    if (!this.creditListPRN?.length || !this.currencySelected) return;

    if (this.lastSyncedCurrency !== this.currencySelected || !this.creditList?.length) {
      this.refreshCreditList();
      this.lastSyncedCurrency = this.currencySelected;
    }

    if (this.creditSelected == null || this.creditSelected >= this.creditList.length) {
      this.creditSelected = 0;
    }

    this.refreshAmountCharge();
  }

  onCurrencySelected(currency: string): void {
    if (!currency) return;
    this.hasUserManuallySelectedCurrency = true;
    this.currencySelected = currency;
    this.refreshCreditList();
    if (this.creditSelected == null) this.creditSelected = 0;
    this.refreshAmountCharge();
  }

  refreshCreditList(): void {
    if (!this.creditListPRN?.length || !this.currencySelected) {
      this.creditList = [];
      return;
    }
    this.creditList = this.creditListPRN.map((creditPRN) =>
      this.UI.roundUpByMagnitude(
        this.UI.convertPRNToCurrency(this.currencySelected, creditPRN)
      )
    );
  }

  refreshAmountCharge(): void {
    if (this.creditSelected == null || this.currencySelected == null) return;
    const selectedCurrency = this.UI.PERRINNAdminLastMessageObj?.currencyList?.[this.currencySelected];
    if (!selectedCurrency || !this.creditList?.length) return;
    
    this.amountCharge = Number(
      ((this.creditList[this.creditSelected] || 0) * 100).toFixed(0)
    );
    this.amountSharesPurchased = Number(
      (this.amountCharge / 100) *
        selectedCurrency.toCOIN
    );
  }

  objectToArray(obj: any): [string, any][] {
    return obj ? Object.entries(obj) : [];
  }

  activateTransactionPending(transactionPendingMessage: string): void {
    if (!transactionPendingMessage) {
      console.error("No transaction message provided");
      return;
    }
    this.UI.createMessage({
      chain: this.UI.currentUser,
      text: `Activating transaction ${transactionPendingMessage}`,
      transactionPending: {
        activateTransactionPending: transactionPendingMessage,
      },
    });
    this.router.navigate(["chat", this.UI.currentUser]);
  }

  async payWithRevolutLink(): Promise<void> {
    if (this.isPaymentFlowLocked) return;

    const newWindow = window.open("", "_blank");
    this.processing = true;
    this.paymentTrackingVersion++;
    this.paymentOrderId = null;
    this.paymentReference = `PRN-${this.UI.currentUser || "anon"}-${Date.now()}`;
    this.paymentStepOrderCreated = false;
    this.paymentStepCheckoutOpened = false;
    this.paymentStepPaymentReceived = false;
    this.paymentStepMessageGenerated = false;
    this.paymentStepCredited = false;
    this.setPaymentState("creating-order", "Creating Revolut order...");

    try {
      const body = {
        amount: this.amountCharge,
        currency: (this.currencySelected || "usd").toUpperCase(),
        email: this.UI.currentUserEmail,
        reference: this.paymentReference,
        description: `Credit ${this.UI.formatPRNCurrency(
          this.currencySelected,
          this.creditList[this.creditSelected]
        )} to ${this.UI.currentUserEmail}`,
        mode: this.UI.revolutMode === "prod" ? "prod" : "sandbox",
        user: this.UI.currentUser,
        amountCharge: this.amountCharge,
        amountSharesPurchased: this.amountSharesPurchased,
      };

      const order = await firstValueFrom(
        this.http.post<RevolutOrderResponse>(
          "https://us-central1-perrinn-d5fc1.cloudfunctions.net/createRevolutOrder",
          body
        )
      );

      if (order?.checkout_url) {
        this.paymentOrderId = order.id || null;
        this.paymentStepOrderCreated = true;
        this.setPaymentState("checkout-opened", "Opening Revolut checkout...");

        if (this.paymentOrderId) {
          this.storePendingPaymentLocalCache();
          this.startPaymentTracking();
        }

        newWindow.location.href = order.checkout_url;
        this.paymentStepCheckoutOpened = true;
        this.setPaymentState("awaiting-payment", "Checkout opened. Complete payment in Revolut, then return here.");
      } else {
        newWindow?.close();
        this.setPaymentState("failed", "Could not open Revolut checkout. Please try again.");
      }
    } catch (err) {
      console.error(err);
      newWindow?.close();
      this.setPaymentState("failed", "Payment request failed. Please try again.");
    } finally {
      this.processing = false;
    }
  }
}
