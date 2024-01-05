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
import { environment } from "environments/environment";

@Component({
  selector: "invest",
  template: `
    <div class="sheet">
      <br />
      <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
        <div class="seperator"></div>
        <div class="title" style="background-color:whitesmoke">
          We are raising money for
        </div>
        <div class="seperator"></div>
        <ul class="listLight">
          <li
            *ngFor="
              let message of currentFunds | async;
              let first = first;
              let last = last
            "
          >
            <div
              *ngIf="message.payload.doc.data()?.fund?.amountGBPTarget > 0"
              style="cursor:default;padding:10px"
            >
              <span style="font-size:14px;font-weight:bold">{{
                message.payload.doc.data()?.chatSubject
              }}</span>
              <div style="clear:both">
                <div
                  style="float:left;background-color:black;height:20px;width:65px;text-align:center;color:white;padding:0 5px 0 5px"
                ></div>
                <div
                  style="float:left;height:20px;background-color:red;margin-left:-65px"
                  [style.width]="
                    (message.payload.doc.data()?.fund?.amountGBPRaised /
                      message.payload.doc.data()?.fund?.amountGBPTarget) *
                      65 +
                    'px'
                  "
                ></div>
                <div
                  style="float:left;background-color:none;width:65px;margin-left:-65px;text-align:center;color:white;padding:0 5px 0 5px"
                >
                  {{
                    message.payload.doc.data()?.fund?.amountGBPRaised /
                      message.payload.doc.data()?.fund?.amountGBPTarget
                      | percent : "1.0-0"
                  }}
                </div>
                <div style="float:left;margin:0 5px 0 5px;font-weight:bold">
                  {{
                    message.payload.doc.data()?.fund?.daysLeft
                      | number : "1.0-0"
                  }}
                  days left
                </div>
                <div style="float:left;margin:0 5px 0 5px">
                  {{ message.payload.doc.data()?.fund?.description }},
                </div>
                <div style="float:left;margin:0 5px 0 5px">
                  target:
                  {{
                    UI.formatSharesToCurrency(
                      null,
                      message.payload.doc.data()?.fund?.amountGBPTarget *
                        UI.currencyList["gbp"].toCOIN
                    )
                  }}
                  /
                </div>
                <div style="float:left">
                  raised:
                  {{
                    UI.formatSharesToCurrency(
                      null,
                      message.payload.doc.data()?.fund?.amountGBPRaised *
                        UI.currencyList["gbp"].toCOIN
                    )
                  }}
                </div>
              </div>
            </div>
            <div class="seperator"></div>
          </li>
        </ul>
      </div>
      <br />
      <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
        <div class="seperator"></div>
        <div class="title" style="background-color:whitesmoke">
          Your investment in details
        </div>
        <div class="seperator"></div>
        <div style="padding:10px;text-align:center">
          <span class="material-symbols-outlined" style="font-size:30px"
            >encrypted</span
          >
          <br />
          <span style="font-size:12px">
            The money you are investing is locked in and secured by our network.
          </span>
          <span style="font-size:15px">{{
            UI.PERRINNAdminLastMessageObj?.statistics?.emailsMembersAuth?.length
          }}</span>
          <span style="font-size:12px"> investors have invested </span>
          <span style="font-size:15px">{{
            UI.formatSharesToCurrency(
              null,
              UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance
            )
          }}</span>
          <span style="font-size:12px">
            .You can follow the impact of your investment live on
            PERRINN.com.</span
          >
        </div>
        <div
          style="color:white;background-color:black;padding:10px;text-align:center"
        >
          <span style="font-size:12px">Interest rate:</span>
          <br />
          <span style="font-size:20px">{{
            costs?.interestRateYear | percent : "0.0"
          }}</span>
          <span style="font-size:12px"> a year.</span>
        </div>
        <div style="padding:10px;text-align:center">
          <span style="font-size:12px"
            >Your investment is stored in your wallet. You can track the
            interests credited in your wallet every day.</span
          >
        </div>
        <div class="seperator"></div>
      </div>
      <br />
      <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
        <div class="seperator"></div>
        <div class="title" style="background-color:whitesmoke">
          Which currency are you using?
        </div>
        <div style="padding:10px">
          <ul class="listLight">
            <li
              *ngFor="let currency of objectToArray(UI.currencyList)"
              (click)="currencySelected = currency[0]; refreshAmountCharge()"
              style="float:left;width:125px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
              [style.background-color]="
                currencySelected == currency[0] ? 'black' : 'white'
              "
              [style.color]="
                currencySelected == currency[0] ? 'white' : 'black'
              "
              [style.border-style]="
                currencySelected == currency[0] ? 'none' : 'solid'
              "
              [style.border-width]="
                currencySelected == currency[0] ? 'none' : '1px'
              "
            >
              {{ currency[1].designation }}
            </li>
          </ul>
        </div>
        <div class="seperator"></div>
      </div>
      <br />
      <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
        <div class="seperator"></div>
        <div class="title" style="background-color:whitesmoke">
          How much would you like to invest?
        </div>
        <div style="padding:10px">
          <ul class="listLight">
            <li
              *ngFor="let investment of investmentList; let index = index"
              (click)="investmentSelected = index; refreshAmountCharge()"
              style="float:left;width:63px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
              [style.background-color]="
                investmentSelected == index ? 'black' : 'white'
              "
              [style.color]="investmentSelected == index ? 'white' : 'black'"
              [style.border-style]="
                investmentSelected == index ? 'none' : 'solid'
              "
              [style.border-width]="
                investmentSelected == index ? 'none' : '1px'
              "
            >
              {{ investment | number : "1.0-0" }}
            </li>
          </ul>
        </div>
        <div class="seperator"></div>
      </div>
      <br />
      <div
        class="module form-module"
        style="width:500px;max-width:80%;border-style:solid;border-width:1px;border-color:#ddd;border-radius:3px"
      >
        <div class="title" style="background-color:whitesmoke">
          Credit or debit card
        </div>
        <div class="form">
          <form (ngSubmit)="createStripeToken()" class="checkout">
            <div id="form-field">
              <div id="card-info" #cardElement></div>
              <br />
              <button
                *ngIf="
                  !processing &&
                  investmentSelected != undefined &&
                  currencySelected != undefined
                "
                id="submit-button"
                type="submit"
              >
                Pay
                {{
                  UI.formatSharesToCurrency(
                    currencySelected,
                    (amountCharge / 100) *
                      UI.currencyList[currencySelected].toCOIN
                  )
                }}
              </button>
              <br />
              <mat-error id="card-errors" role="alert" *ngIf="stripeMessage">
                &nbsp;{{ stripeMessage }}
              </mat-error>
            </div>
          </form>
        </div>
        <div class="seperator"></div>
        <div style="float:right">
          <img
            src="./../assets/App icons/poweredByStripe2.png"
            style="width:175px"
          />
        </div>
      </div>
      <br />
    </div>
  `,
})
export class InvestComponent {
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  amountSharesPurchased: number;
  amountCharge: number;
  currencySelected: string;
  costs: any;
  investmentList: any;
  investmentSelected: number;
  math: any;
  card: any;
  cardHandler = this.onChange.bind(this);
  stripeMessage: string;
  @ViewChild("cardElement") cardElement: ElementRef;
  processing: boolean;
  currentFunds: Observable<any[]>;

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.afAuth.user.subscribe((auth) => {
      if (auth == null) {
        this.router.navigate(["login"]);
      }
    });
    if (UI.currentUserLastMessageObj != undefined)
      this.currencySelected =
        UI.currentUserLastMessageObj.userCurrency || "usd";
    else this.currencySelected = "usd";
    this.processing = false;
    this.math = Math;
    this.investmentList = [100, 200, 500, 1000];
    afs
      .doc<any>("appSettings/costs")
      .valueChanges()
      .subscribe((snapshot) => {
        this.costs = snapshot;
      });
    this.currentFunds = this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("lastMessage", "==", true)
          .where("verified", "==", true)
          .where("fund.active", "==", true)
          .orderBy("fund.daysLeft", "asc")
      )
      .snapshotChanges()
      .pipe(
        map((changes) => {
          return changes.map((c) => ({ payload: c.payload }));
        })
      );
  }

  ngAfterViewInit() {
    this.card = elements.create("card");
    this.card.mount(this.cardElement.nativeElement);
    this.card.addEventListener("change", this.cardHandler);
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
      this.investmentSelected != undefined &&
      this.currencySelected != undefined
    ) {
      this.amountCharge = Number(
        ((this.investmentList[this.investmentSelected] || 0) * 100).toFixed(0)
      );
      this.amountSharesPurchased = Number(
        (this.amountCharge / 100) *
          this.UI.currencyList[this.currencySelected].toCOIN
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
    const params = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${""}`,
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
