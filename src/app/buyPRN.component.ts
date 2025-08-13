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
    <div class="sheet">
      <br />
      <div *ngIf="transactionPendingMessageObj" class="sheet" style="width:500px;max-width:80%">
        <div class="separator"></div>
        <div *ngIf="!transactionPendingMessageObj?.transactionPending?.activated">
          <div class="title">
            There is a pending transaction ready for you.
          </div>
          <div style="padding:10px;text-align:center">
            <span>{{transactionPendingMessageObj.name}} is sending you {{UI.formatSharesToPRNCurrency(null,transactionPendingMessageObj.transactionPending.amount||0)}} (Reference: {{transactionPendingMessageObj.transactionPending.reference}}).</span>
            <button *ngIf="!UI.currentUser" class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="router.navigate(['login'])" [disabled]='this.router.url.startsWith("/login")'>Login</button>
            <div *ngIf="UI.currentUser&&!UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonWhite" style="margin:10px auto;width:200px;font-size:11px" (click)="router.navigate(['settings'])">Update you profile picture</div>
            <div *ngIf="UI.currentUser&&UI.currentUserLastMessageObj.isImageUserUpdated" class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="activateTransactionPending(transactionPendingMessage)">Activate transaction</div>
          </div>
        </div>
        <div *ngIf="transactionPendingMessageObj?.transactionPending?.activated">
          <div class="title">
            This transaction has already been activated.
          </div>
        </div>
        <div class="separator"></div>
      </div>
      <br />
      <div class="sheet" style="width:500px;max-width:80%">
        <div class="separator"></div>
        <div class="title" style=";text-align:center">
          <img src="./../assets/App icons/PRN token.png" style=";width:150px">
        </div>
        <div class="separator"></div>
        <div style="padding:10px;text-align:center">
          <span>PRN tokens represent ownership of the PERRINN team.</span>
          <br />
          <span>{{UI.PERRINNAdminLastMessageObj?.statistics?.emailsContributorsAuth?.length}} members own {{UI.formatSharesToPRNCurrency(currencySelected,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}.</span>
          <br />
          <span>You can follow the impact of your investment live on PERRINN.com</span>
          <div class="buttonWhite" style="margin:10px auto;width:150px;font-size:11px" (click)="router.navigate(['directory'])">PRN holders directory</div>
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
        <div class="separator"></div>
      </div>
      <br />
      <div class="sheet" style="width:500px;max-width:80%">
        <div class="separator"></div>
        <div class="title">
          The capital raised from token sales goes towards
        </div>
        <div class="separator"></div>
        <ul class="listLight">
          <li *ngFor="let message of currentFunds|async">
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
                <div style="float:left;margin:0 5px 0 5px">target: {{UI.formatSharesToCurrency(null,message.payload.doc.data()?.fund?.amountGBPTarget*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}} /</div>
                <div style="float:left">raised: {{UI.formatSharesToCurrency(null,message.payload.doc.data()?.fund?.amountGBPRaised*UI.appSettingsPayment.currencyList["gbp"].toCOIN)}}</div>
              </div>
            </div>
          </li>
        </ul>
      <div class="buttonBlack" *ngIf="!showPastFunds" (click)="showPastFunds=!showPastFunds">Show past funds</div>
      <div class="separator"></div>
      </div>
      <br />
      <div *ngIf="UI.currentUser" class="sheet" style="width:500px;max-width:80%">
        <div class="separator"></div>
        <div class="title">
          Which currency are you using?
        </div>
        <div style="padding:10px">
          <ul class="listLight">
            <li class="buttonBlack"
              *ngFor="let currency of objectToArray(UI.appSettingsPayment.currencyList)"
              (click)="currencySelected = currency[0]; refreshAmountCharge()"
              style="float:left;width:125px;margin:5px"
              [style.border-color]="
                currencySelected == currency[0] ? 'white' : 'black'
              "
            >
              {{ currency[1].designation }}
            </li>
          </ul>
        </div>
        <div class="separator"></div>
      </div>
      <br />
      <div *ngIf="UI.currentUser" class="sheet" style="width:500px;max-width:80%">
        <div class="separator"></div>
        <div class="title">
          How much PRN would you like to buy?
        </div>
        <div style="padding:10px">
          <ul class="listLight">
            <li class="buttonBlack"
              *ngFor="let credit of creditList; let index = index"
              (click)="creditSelected = index; refreshAmountCharge()"
              style="float:left;width:75px;margin:5px"
              [style.border-color]="creditSelected == index ? 'white' : 'black'">
            {{UI.formatSharesToCurrency(currencySelected,credit*UI.appSettingsPayment.currencyList[currencySelected].toCOIN)}}
            </li>
          </ul>
          <br />
          <div *ngIf="creditSelected!=undefined&&currencySelected!=undefined" style="text-align:center">
            You will pay {{UI.formatSharesToCurrency(currencySelected,creditList[creditSelected]*UI.appSettingsPayment.currencyList[currencySelected].toCOIN)}} and recieve {{UI.formatSharesToPRNCurrency(currencySelected,creditList[creditSelected]*UI.appSettingsPayment.currencyList[currencySelected].toCOIN)}}.
          </div>
        </div>
        <br />
      <div class="buttonWhite" *ngIf="UI.currentUser && !processing && creditSelected!=undefined && currencySelected!=undefined"
              (click)="payWithRevolutLink()"
              style="width:200px;margin:10px auto;font-size:14px;text-align:center;line-height:25px;padding:4px">
        Go to checkout
      </div>
        <div class="separator"></div>
      </div>
      <br />
      <div class="separator" style="width:100%;margin-top:150px"></div>
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
            this.transactionPendingMessageObj = document; // Save the document as transactionPendingMessageObj
          } else {
            console.log('No document found with the given ID.');
            this.transactionPendingMessageObj = null; // Handle the case where no document is found
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
    // credit list
    this.creditList = this.UI.isDev
      ? [1, 100, 200, 500, 1000]
      : [50, 100, 200, 500, 1000];  }
  
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
    // Open a blank tab immediately on click
    const newWindow = window.open('', '_blank');
  
    try {
      const mode = this.UI.revolutMode === 'prod' ? 'prod' : 'sandbox';
      const body = {
        amount: this.amountCharge,
        currency: (this.currencySelected || 'usd').toUpperCase(),
        email: this.UI.currentUserEmail,
        reference: `PRN-${Date.now()}`,
        description: `Credit ${this.UI.formatSharesToPRNCurrency(this.currencySelected,this.creditList[this.creditSelected]*this.UI.appSettingsPayment.currencyList[this.currencySelected].toCOIN)} to ${this.UI.currentUserEmail}`,
        mode
      };
  
      const fnUrl = 'https://us-central1-perrinn-d5fc1.cloudfunctions.net/createRevolutOrder';
      const order: any = await firstValueFrom(this.http.post(fnUrl, body));
  
      if (order.checkout_url) {
        newWindow.location.href = order.checkout_url; // Load Revolut in the tab we opened
      } else {
        newWindow.close();
      }
    } catch (err) {
      console.error(err);
      if (newWindow) newWindow.close();
    }
  }
  
}
