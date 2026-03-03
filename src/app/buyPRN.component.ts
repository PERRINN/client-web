import {
  AfterViewInit,
  ChangeDetectorRef,
  ElementRef,
  Inject,
  OnDestroy,
  ViewChild,
} from "@angular/core";
import { Component, NgZone } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Router, ActivatedRoute } from '@angular/router'
import { UserInterfaceService } from "./userInterface.service";
import {
  AngularFirestore,
  AngularFirestoreCollection,
} from "@angular/fire/compat/firestore";
import { AngularFireAuth } from "@angular/fire/compat/auth";
import firebase from "firebase/compat/app";
import { environment } from '../environments/environment';
import { AgChartOptions } from 'ag-charts-community';
import RevolutCheckout from '@revolut/checkout';

import { firstValueFrom } from 'rxjs';

interface RevolutOrderResponse {
  id: string;
  token: string;      // ✅ add this
  mode: 'prod' | 'sandbox'; // ✅ add if missing
  // ... other fields you use
}


@Component({
  selector: "buyPRN",
  template: `
  <div style="max-width:500px;margin:0 auto">
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e0e0e0; background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%); min-height: 100vh; padding: 20px;">
    <div *ngIf="transactionPendingMessageObj" class="island">
      <div *ngIf="!transactionPendingMessageObj?.transactionPending?.activated">
        <div class="title">
          There is a pending transaction ready for you.
        </div>
        <div style="padding:10px;text-align:center">
          <span>{{transactionPendingMessageObj.name}} is sending you {{UI.convertAndFormatPRNToPRNCurrency(currencySelected,transactionPendingMessageObj.transactionPending.amount||0)}} (Reference: {{transactionPendingMessageObj.transactionPending.reference}}).</span>
          <button *ngIf="!UI.currentUser" class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="router.navigate(['login'])" [disabled]='this.router.url.startsWith("/login")'>Login</button>
          <button *ngIf="UI.currentUser&&!UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonWhite" style="margin:10px auto;width:200px;font-size:11px" (click)="router.navigate(['settings'])">Update you profile picture</button>
          <button *ngIf="UI.currentUser&&UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="activateTransactionPending(transactionPendingMessage)">Activate transaction</button>
        </div>
      </div>
      <div *ngIf="transactionPendingMessageObj?.transactionPending?.activated">
        <div class="title">
          This transaction has already been activated.
        </div>
      </div>
    </div>
    <br/>
    <div *ngIf="!UI.isCurrentUserMember" class="island" style="background-color: #38761D; padding: 20px; border-radius: 8px;">
      <div class="title" style="color: #ffffff; font-size: 20px; font-weight: bold;">
        🔑 Unlock Your Membership
      </div>
      <div style="padding:15px;text-align:center">
        <div style="font-size: 24px; font-weight: bold; color: #ffffff; margin-bottom: 10px;">
          {{UI.convertAndRoundUpAndFormatPRNToCurrency(currencySelected,UI.PERRINNAdminLastMessageObj?.membership?.amountRequired)}}
        </div>
        <span style="font-size: 14px; line-height: 1.8; color: #f0f0f0;">
          <strong>One-time investment.</strong> No subscriptions. No recurring charges. Own your place in PERRINN forever.
        </span>
        <br /><br />
        <div style="background-color: rgba(255, 255, 255, 0.15); padding: 12px; border-radius: 8px; margin: 10px 0;">
          <span style="font-size: 13px; line-height: 1.6; color: #ffffff;">
            ✓ <strong>Lifetime membership</strong> — once in, always in<br/>
            ✓ <strong>Ownership stake</strong> in the PERRINN team<br/>
            ✓ <strong>Growing value</strong> — increases {{UI.appSettingsCosts?.interestRateYear | percent : "0.0"}} yearly<br/>
            ✓ <strong>Early advantage</strong> — entry costs rise as the network grows
          </span>
        </div>
        <br />
        <span style="font-size: 12px; color: #e0e0e0; font-style: italic;">
          Early members shape the future. Your commitment lasts — and so does your influence.
        </span>
      </div>
    </div>
    <div *ngIf="UI.isCurrentUserMember" class="island" style="background-color: #38761D; padding: 20px; border-radius: 8px;">
      <div class="title" style="color: #ffffff; font-size: 20px; font-weight: bold;">
        ✅ Your Membership is Live
      </div>
      <div style="padding:15px;text-align:center">
        <div style="font-size: 24px; font-weight: bold; color: #ffffff; margin-bottom: 15px;">
          {{UI.convertAndFormatPRNToPRNCurrency(currencySelected, UI.currentUserLastMessageObj?.wallet?.balance || 0)}}
        </div>
        <div style="background-color: rgba(255, 255, 255, 0.15); padding: 12px; border-radius: 8px; margin: 10px 0;">
          <span style="font-size: 13px; line-height: 1.8; color: #ffffff;">
            ✓ <strong>Lifetime membership active</strong> — you're in forever<br/>
            ✓ <strong>You own {{UI.convertAndFormatPRNToPRNCurrency(currencySelected, UI.currentUserLastMessageObj?.wallet?.balance || 0)}}</strong> of PERRINN<br/>
            ✓ <strong>Growing value</strong> — your holdings increase {{UI.appSettingsCosts?.interestRateYear | percent : "0.0"}} yearly<br/>
            ✓ <strong>Full member status</strong> — shape the future with voting rights<br/>
            ✓ <strong>Access to exclusive opportunities</strong> within the PERRINN network
          </span>
        </div>
        <br />
        <span style="font-size: 12px; color: #e0e0e0; font-style: italic;">
          Your investment is secure. Your influence is permanent.
        </span>
      </div>
    </div>
    <br/>
    <div class="island" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px; border: 1px solid rgba(76, 175, 80, 0.2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);">
      <div style="text-align:center">
        <img src="./../assets/App icons/PRN token.png" style=";width:150px">
      </div>
      <div style="padding:10px;text-align:center">
        <span>PRN tokens represent ownership of the PERRINN team.</span>
        <br />
        <div style="padding:16px;text-align:left; margin-bottom: 12px;">
          <div style="font-size: 13px; color: #b0b0b0; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Token Overview
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <div style="background-color: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 8px; border-left: 3px solid #4CAF50;">
              <div style="font-size: 11px; color: #a0a0a0; margin-bottom: 4px;">Total Members</div>
              <div style="font-size: 16px; font-weight: bold; color: #4CAF50;">{{UI.PERRINNAdminLastMessageObj?.statistics?.membersCount}}</div>
            </div>
            <div style="background-color: rgba(76, 175, 80, 0.1); padding: 12px; border-radius: 8px; border-left: 3px solid #4CAF50;">
              <div style="font-size: 11px; color: #a0a0a0; margin-bottom: 4px;">Total Supply</div>
              <div style="font-size: 16px; font-weight: bold; color: #4CAF50;">{{UI.convertAndFormatPRNToPRNCurrency(currencySelected,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}</div>
            </div>
          </div>
        </div>
        <button class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="router.navigate(['directory'])">PRN holders directory</button>
      </div>
      <div style="background-color:black;padding:10px;text-align:center">
        <span>Your PRN amount grows at a rate of {{UI.appSettingsCosts?.interestRateYear | percent : "0.0"}} a year</span>
        <div style="height:200px;margin-top:10px"><ag-charts-angular [options]="chartOptions"></ag-charts-angular></div>
      </div>
      <div style="padding:10px;text-align:center">
        <span class="material-symbols-outlined" style="font-size:30px">encrypted</span>
        <br />
        <span>Your tokens are stored in your wallet on PERRINN.com</span>
        <br />
        <span>Soon you will be able to sell or exchange your tokens with other members here.</span>
      </div>
    </div>
    <br/>
    <div class="island" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px; border: 1px solid rgba(76, 175, 80, 0.2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);">
      <div class="title">
        Your Tokens Fund Real Projects
      </div>
      <div style="padding:16px;text-align:left;">
        <span style="font-size: 13px; color: #a0a0a0; line-height: 1.6; display: block; margin-bottom: 16px;">
          All capital raised through PRN token sales is transparently allocated to active PERRINN initiatives. See the Allocation and Progress Below
        </span>
      </div>
      <ul class="listLight">
        <li *ngFor="let message of currentFunds|async" style="padding:0px">
          <div *ngIf="message.payload.doc.data()?.fund?.amountGBPTarget>0&&(message.payload.doc.data()?.fund?.active||showPastFunds)" style="cursor:default;padding:10px">
            <span style="font-size:14px">{{message.payload.doc.data()?.chatSubject}}</span>
            <div style="clear:both">
              <div style="float:left;background-color:black;height:20px;width:65px;text-align:center;padding:0 5px 0 5px"></div>
              <div style="float:left;height:20px;background-color:#38761D;margin-left:-65px"
                [style.width]="(message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget)*65+'px'"></div>
              <div style="float:left;background-color:none;width:65px;margin-left:-65px;text-align:center;padding:0 5px 0 5px">
                {{message.payload.doc.data()?.fund?.amountGBPRaised/message.payload.doc.data()?.fund?.amountGBPTarget|percent:"1.0-0"}}
              </div>
              <div *ngIf="message.payload.doc.data()?.fund?.active" style="float:left;margin:0 5px 0 5px">{{message.payload.doc.data()?.fund?.daysLeft|number:"1.0-0"}} days left</div>
              <div *ngIf="!message.payload.doc.data()?.fund?.active" style="float:left;margin:0 5px 0 5px">{{-message.payload.doc.data()?.fund?.daysLeft|number:"1.0-0"}} days ago</div>
              <div style="float:left;margin:0 5px 0 5px">{{ message.payload.doc.data()?.fund?.description }},</div>
              <div style="float:left;margin:0 5px 0 5px">target: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPTarget*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} /</div>
              <div style="float:left">raised: {{UI.convertAndFormatPRNToCurrency(null,message.payload.doc.data()?.fund?.amountGBPRaised*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}}</div>
            </div>
          </div>
        </li>
      </ul>
      <button class="buttonWhite" *ngIf="!showPastFunds" style="margin:10px auto;width:150px" (click)="showPastFunds=!showPastFunds">Show past funds</button>
    </div>
    <br/>
    <div *ngIf="UI.currentUser" class="island" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px; border: 1px solid rgba(76, 175, 80, 0.2); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);">
      <div style="display: flex; align-items: center; margin-bottom: 20px;">
        <span class="material-symbols-outlined" style="font-size: 28px; color: #4CAF50; margin-right: 10px;">payment</span>
        <div class="title" style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 600;">
          Secure Payment
        </div>
      </div>
      
      <div style="padding: 12px 14px; background-color: rgba(76, 175, 80, 0.06); border-radius: 8px; border-left: 3px solid #4CAF50; margin-bottom: 20px;">
        <span style="font-size: 12px; color: #b0b0b0; display: flex; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 8px; color: #4CAF50;">shield_lock</span>
          Powered by Revolut
        </span>
      </div>

      <div style="padding: 0; margin-bottom: 20px;">
        <div style="font-size: 13px; color: #b0b0b0; margin-bottom: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          Select Currency
        </div>
        <ul class="listLight">
          <li>
            <button class="buttonBlack"
              *ngFor="let currency of objectToArray(UI.appSettingsPayment.currencyList)"
              (click)="currencySelected = currency[0]; refreshCreditList(); refreshAmountCharge()"
              style="float:left;width:125px;margin:5px; padding: 10px; border-radius: 8px; border: 2px solid; transition: all 0.3s ease; font-weight: 500;"
              [style.background-color]="currencySelected == currency[0] ? '#4CAF50' : '#2a2a3e'"
              [style.border-color]="currencySelected == currency[0] ? '#4CAF50' : 'rgba(76, 175, 80, 0.15)'"
              [style.color]="currencySelected == currency[0] ? '#ffffff' : '#b0b0b0'"
            >
              {{ currency[1].designation }}
            </button>
          </li>
        </ul>
      </div>

      <div style="padding: 0;">
        <div style="font-size: 13px; color: #b0b0b0; margin-bottom: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          Select Amount
        </div>
        <ul class="listLight">
          <li>
            <button class="buttonBlack"
              *ngFor="let credit of creditList; let index = index"
              (click)="creditSelected = index; refreshAmountCharge()"
              style="float:left;width:75px;margin:5px; padding: 10px; border-radius: 8px; border: 2px solid; transition: all 0.3s ease; font-weight: 500;"
              [style.background-color]="creditSelected == index ? '#4CAF50' : '#2a2a3e'"
              [style.border-color]="creditSelected == index ? '#4CAF50' : 'rgba(76, 175, 80, 0.15)'"
              [style.color]="creditSelected == index ? '#ffffff' : '#b0b0b0'"
            >
            {{UI.formatCurrency(currencySelected,credit)}}
            </button>
          </li>
        </ul>
        <br />
        <div *ngIf="creditSelected!=undefined&&currencySelected!=undefined" style="text-align:center; padding: 14px; background-color: rgba(76, 175, 80, 0.08); border-radius: 8px; margin-top: 12px; border-left: 3px solid #4CAF50;">
          <span style="color: #e0e0e0; font-size: 13px;">
            You will pay <strong style="color: #4CAF50; font-size: 15px;">{{UI.formatCurrency(currencySelected,creditList[creditSelected])}}</strong>
          </span>
          <br/>
          <span style="color: #a0a0a0; font-size: 12px; margin-top: 6px; display: block;">
            and recieve <strong style="color: #4CAF50;">{{UI.formatPRNCurrency(currencySelected,creditList[creditSelected])}}</strong>
          </span>
        </div>
      </div>

      <button class="buttonWhite" *ngIf="UI.currentUser && !processing && creditSelected!=undefined && currencySelected!=undefined"
              (click)="payWithRevolutLink()"
              style="width:100%; margin:20px 0 0 0; font-size:14px; line-height: 20px; padding: 14px 16px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); border: none; border-radius: 8px; color: white; font-weight: 600; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);">
        <span class="material-symbols-outlined" style="font-size: 18px; vertical-align: middle; margin-right: 6px;">payment</span>
        Go to Secure Checkout
      </button>
    </div>
  </div>
`,
})
export class buyPRNComponent {
  cardNumber:string
  expiryMonth:string
  expiryYear:string
  cvc:string
  transactionPendingMessage:string
  transactionPendingMessageObj:any
  amountSharesPurchased:number
  amountCharge:number
  currencySelected:string
  creditListPRN:any
  creditList:any
  creditSelected:number
  math:any
  processing:boolean
  currentFunds:Observable<any[]>
  chartOptions:AgChartOptions
  showPastFunds:boolean
  
  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private route:ActivatedRoute,
    private http: HttpClient,
  ) {
    if (UI.currentUserLastMessageObj != undefined)
      this.currencySelected =
        UI.currentUserLastMessageObj.userCurrency || "usd";
    else this.currencySelected = "usd";
    this.route.params.subscribe(params=>{
      this.transactionPendingMessage=params.id
      this.afs
      .doc<any>(`PERRINNMessages/${params.id}`)
      .valueChanges()
      .subscribe(
        (document) => {
          if (document) {
            console.log('Document retrieved:', document);
            this.transactionPendingMessageObj = document;
          } else {
            console.log('No document found with the given ID.');
            this.transactionPendingMessageObj = null;
          }
        },
        (error) => {
          console.error('Error retrieving document:', error);
        }
      );
    })
    this.processing=false
    this.showPastFunds=false
    this.math = Math;
    this.currentFunds = this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("lastMessage", "==", true)
          .where("verified", "==", true)
          .orderBy("fund.daysLeft", "desc")
      )
      .snapshotChanges()
      .pipe(
        map((changes) => {
          return changes.map((c) => ({ payload: c.payload }));
        })
      );
      this.chartOptions = {
            title: { text: 'PRN growth' },
            data: [
              { year: 1296578670000, price: 1 },
              { year: this.UI.nowSeconds*1000-6*365*24*3600000, price: Math.exp((this.UI.nowSeconds*1000-6*365*24*3600000-1296578670000)/1000/3600/24/365*0.1) },
              { year: this.UI.nowSeconds*1000, price: Math.exp((this.UI.nowSeconds*1000-1296578670000)/1000/3600/24/365*0.1) },
              { year: this.UI.nowSeconds*1000+6*365*24*3600000, price: Math.exp((this.UI.nowSeconds*1000+6*365*24*3600000-1296578670000)/1000/3600/24/365*0.1) },
            ],
            series: [{ type: 'line', xKey: 'year', yKey: 'price' }],
            theme: 'ag-default-dark',
            axes: [{ type: 'time', position: 'bottom' },{type: 'number',position: 'left',keys: ['price']}],
      }
  }

  ngOnInit() {
    this.creditListPRN = this.UI.isDev
      ? [1, this.UI.PERRINNAdminLastMessageObj.membership.amountRequired,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*2,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*4,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*10,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*20,
      ]
      : [this.UI.PERRINNAdminLastMessageObj.membership.amountRequired,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*2,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*4,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*10,
        this.UI.PERRINNAdminLastMessageObj.membership.amountRequired*20,
      ]
    this.refreshCreditList();
  }

  refreshCreditList() {
    this.creditList = this.creditListPRN.map((creditPRN) => {
      return this.UI.roundUpByMagnitude(this.UI.convertPRNToCurrency(this.currencySelected, creditPRN));
    });
  }

  refreshAmountCharge() {
    if (this.creditSelected != undefined && this.currencySelected != undefined) {
      this.amountCharge = Number(((this.creditList[this.creditSelected] || 0) * 100).toFixed(0));
      this.amountSharesPurchased = Number(
        (this.amountCharge / 100) * this.UI.appSettingsPayment.currencyList[this.currencySelected].toCOIN
      );
    }
  }
  
  objectToArray(obj) {
    if (obj == null) {
      return [];
    }
    return Object.keys(obj).map(function (key) {
      return [key, obj[key]];
    });
  }

  activateTransactionPending(transactionPendingMessage) {
    if (!transactionPendingMessage) {
      console.error("No transaction message provided");
      return;
    }
    this.UI.createMessage({
      chain: this.UI.currentUser,
      text: "Activating transaction " + transactionPendingMessage,
      transactionPending: {
        activateTransactionPending: transactionPendingMessage
      },
    });
    this.router.navigate(['chat', this.UI.currentUser]);
  }

  async payWithRevolutLink() {
    const newWindow = window.open('', '_blank');
  
    try {
      const mode = this.UI.revolutMode === 'prod' ? 'prod' : 'sandbox';
      const body = {
        amount: this.amountCharge,
        currency: (this.currencySelected || 'usd').toUpperCase(),
        email: this.UI.currentUserEmail,
        reference: `PRN-${Date.now()}`,
        description: `Credit ${this.UI.formatPRNCurrency(this.currencySelected,this.creditList[this.creditSelected])} to ${this.UI.currentUserEmail}`,
        mode
      };
  
      const fnUrl = 'https://us-central1-perrinn-d5fc1.cloudfunctions.net/createRevolutOrder';
      const order: any = await firstValueFrom(this.http.post(fnUrl, body));
  
      if (order.checkout_url) {
        newWindow.location.href = order.checkout_url;
      } else {
        newWindow.close();
      }
    } catch (err) {
      console.error(err);
      if (newWindow) newWindow.close();
    }
  }
}
