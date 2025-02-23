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
import { Router } from "@angular/router";
import { UserInterfaceService } from "./userInterface.service";
import {
  AngularFirestore,
  AngularFirestoreCollection,
} from "@angular/fire/compat/firestore";
import { AngularFireAuth } from "@angular/fire/compat/auth";
import firebase from "firebase/compat/app";
import { environment } from "environments/environment.prod";
import { AgChartOptions } from 'ag-charts-community';

@Component({
  selector: "buyPRN",
  templateUrl: './buyPRN.component.html',
})

export class buyPRNComponent {
  cardNumber:string
  expiryMonth:string
  expiryYear:string
  cvc:string
  amountSharesPurchased:number
  amountCharge:number
  currencySelected:string
  creditList:any
  creditSelected:number
  math:any
  card:any
  cardHandler = this.onChange.bind(this)
  stripeMessage:string
  @ViewChild("cardElement") cardElement:ElementRef
  processing:boolean
  currentFunds:Observable<any[]>
  public chartOptions:AgChartOptions
  showPastFunds:boolean

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private http: HttpClient
  ) {
    if (UI.currentUserLastMessageObj != undefined)
      this.currencySelected =
        UI.currentUserLastMessageObj.userCurrency || "usd";
    else this.currencySelected = "usd";
    this.processing=false
    this.showPastFunds=false
    this.math = Math;
    if(this.UI.currentUser=='QYm5NATKa6MGD87UpNZCTl6IolX2')this.creditList=[1,100,200,500,1000]
    else this.creditList=[50,100,200,500,1000]
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

  ngAfterViewInit() {
    this.card = elements.create("card");
    this.card.mount(this.cardElement.nativeElement);
    this.card.addEventListener("change", this.cardHandler);
  }

  ngOnInit() {
  }

  ngOnDestroy() {
    if (this.card) {
      this.card.destroy();
    }
  }

  onChange({ error }) {
    if (error) this.stripeMessage = error.message;
    else this.stripeMessage = null;
    this.cd.detectChanges();
  }
  async createStripeToken() {
    this.processing = true;
    this.createPaymentIntent(this.amountCharge, this.currencySelected);
    // const { token, error } = await stripe.createToken(this.card);
    // if (token) this.onSuccess(token);
    // else this.onError(error);
  }
  onSuccess(paymentIntent) {
    this.card.destroy();
    this.stripeMessage = "processing payment";
    this.afs
      .collection("PERRINNTeams/" + this.UI.currentUser + "/payments")
      .add({
        source: paymentIntent,
        amountSharesPurchased: this.amountSharesPurchased,
        amountCharge: this.amountCharge,
        currency: this.currencySelected,
        user: this.UI.currentUser,
        serverTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
      })
      .then((chargeID) => {
        this.afs
          .doc<any>(
            "PERRINNTeams/" + this.UI.currentUser + "/payments/" + chargeID.id
          )
          .valueChanges()
          .subscribe((payment) => {
            if (payment.status)
              this.stripeMessage = `Payment ${payment.status}`;
          });
      });
  }
  onError(error) {
    this.processing = false;
    if (error.message) this.stripeMessage = error.message;
  }

  refreshAmountCharge() {
    if (
      this.creditSelected != undefined &&
      this.currencySelected != undefined
    ) {
      this.amountCharge = Number(
        ((this.creditList[this.creditSelected] || 0) * 100).toFixed(0)
      );
      this.amountSharesPurchased = Number(
        (this.amountCharge / 100) *
          this.UI.appSettingsPayment.currencyList[this.currencySelected].toCOIN
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

  createPaymentIntent(amount: number, currency: string) {
    const url = "https://api.stripe.com/v1/payment_intents";
    var urlencoded = new URLSearchParams();
    urlencoded.append("amount", amount.toString());
    urlencoded.append("currency", currency);
    urlencoded.append("receipt_email", this.UI.currentUserEmail);
    urlencoded.append(
      "description",
      `${this.amountSharesPurchased} Shares to ${this.UI.currentUserEmail}`
    );
    const params = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${environment.STRIPE_SECRET}`,
      },
    };
    const res = this.http.post(url, urlencoded, params).subscribe(
      (success) => {
        this.submitPayment(success);
      },
      ({ error: { error } }) => {
        console.log(error);
        this.stripeMessage = error.errorMessage;
      }
    );
    return res;
  }

  submitPayment = async (intent) => {
    console.log("success");
    const data = {
      payment_method: { card: this.card },
    };
    const { paymentIntent, error } = await stripe.confirmCardPayment(
      intent.client_secret,
      data
    );
    if (error) {
      this.onError(error);
    }
    if (paymentIntent) this.onSuccess(paymentIntent);
  };
}
