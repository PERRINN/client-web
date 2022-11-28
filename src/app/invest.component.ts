import { Component, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import * as firebase from 'firebase/app';

@Component({
  selector:'invest',
  template:`
  <div class='sheet'>
  <br>
  <div class="sheet" style="width:400px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div *ngIf="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal!=undefined" style="clear:both">
      <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%">
    </div>
    <div class="title" style="padding:10px;text-align:center">PERRINN is a team built like a social network.</div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:12px">PERRINN is designed to innovate faster than traditional organisations and deliver challenging projects like 424.</span>
      <br>
      <span style="font-size:12px">You can invest into 424 and PERRINN buy purchasing Shares.</span>
      <br>
      <span style="font-size:12px">PERRINN has </span>
      <span style="font-size:15px">{{UI.PERRINNAdminLastMessageObj?.statistics?.emailsMembersAuth?.length}}</span>
      <span style="font-size:12px"> investors and </span>
      <span style="font-size:15px">{{UI.formatCOINS(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}</span>
      <span style="font-size:12px"> Shares distributed.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="width:400px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">Investment</div>
    <div class="seperator"></div>
    <div style="padding:10px;text-align:center">
      <span class="material-icons-outlined" style="font-size:30px">verified</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> Your Shares are backed by the open source technology we are developing.</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> Your investment is going into 424 and PERRINN development.</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> You can follow and query the impact of your investment live on PERRINN.com.</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> Investing gives you full access to the team.</span>
      <br>
    </div>
    <div style="color:white;background-color:black;padding:10px;text-align:center">
      <span style="font-size:12px">Your Share balance increases automatically by</span>
      <br>
      <span style="font-size:20px">{{costs?.interestRateYear|percent:'0.0'}}</span>
      <span style="font-size:12px"> a year</span>
    </div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:12px">The Shares are stored in your wallet. You can track the interests added to your wallet every day. You will be able to sell your Shares at a later stage realising a return &#42;.</span>
      <br>
      <span style="font-size:10px">(&#42;) When 424 realises a profit through sponsorship rights, all investors will be contacted and offered the same opportunity to sell some of their Shares back to PERRINN.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="width:400px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">How many Shares do you want to purchase?</div>
    <div style="padding:10px">
      <ul class="listLight">
        <li *ngFor="let investment of investmentList;let index=index"
          (click)="investmentSelected==index?investmentSelected=null:investmentSelected=index;refreshAmountCharge()"
          style="float:left;width:63px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
          [style.background-color]="investmentSelected==index?'black':'white'"
          [style.color]="investmentSelected==index?'white':'black'"
          [style.border-style]="investmentSelected==index?'none':'solid'"
          [style.border-width]="investmentSelected==index?'none':'1px'">
          {{investment|number:'1.1-1'}} Shares
        </li>
      </ul>
    </div>
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">You are purchasing {{amountCOINSPurchased|number:'1.1-1'}} Shares</div>
    <div class="seperator"></div>
    <div class="title">Select your currency</div>
    <ul class="listLight">
      <li *ngFor="let currency of objectToArray(currencyList)"
        [class.selected]="currency[0] === currentCurrencyID"
        (click)="currentCurrencyID = currency[0];refreshAmountCharge()"
        style="padding:15px">
        <div style="width:250px;height:20px;float:left;font-size:15px">{{currency[1].designation}}</div>
        <div style="height:20px;float:left;font-size:10px">1 Share costs {{1/currency[1].toCOIN|number:'1.2-2'}} {{currency[1].code}}</div>
      </li>
    </ul>
    <div class="seperator"></div>
    <div class="title" style="float:right">Total cost {{amountCharge/100 | number:'1.2-2'}} {{currentCurrencyID | uppercase}}</div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="module form-module" style="width:400px;max-width:80%;border-style:solid;border-width:1px;border-color:#ddd;border-radius:3px">
  <div class="form">
  <form>
  <div style="margin:10px">
    <img src="./../assets/App icons/Payment Method Icons/Light Color/22.png" style="width:40px">
    <img src="./../assets/App icons/Payment Method Icons/Light Color/2.png" style="width:40px">
    <img src="./../assets/App icons/Payment Method Icons/Light Color/1.png" style="width:40px">
  </div>
  <input [(ngModel)]="cardNumber" name="card-number" type="text" placeholder="Card number *" (keyup)='messagePayment=""'>
  <div>
  <input [(ngModel)]="expiryMonth" style="width:30%;float:left" name="expiry-month" type="text" placeholder="MM *" (keyup)='messagePayment=""'>
  <div style="font-size:30px;line-height:40px;float:left">/</div>
  <input [(ngModel)]="expiryYear" style="width:30%;float:left" name="expiry-year" type="text" placeholder="YY *" (keyup)='messagePayment=""'>
  </div>
  <input [(ngModel)]="cvc" name="cvc" type="text"  placeholder="CVC *" (keyup)='messagePayment=""'>
  <button type="button" (click)="processPayment()">Pay {{amountCharge/100 | number:'1.2-2'}} {{currentCurrencyID | uppercase}}</button>
  </form>
  </div>
  </div>
  <br>
  <div class='sheet' style="width:400px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class='content' style="text-align:center;min-height:50px">{{messagePayment}}</div>
    <div class="seperator"></div>
  </div>
  <br>
  </div>
  `,
})
export class InvestComponent {
  cardNumber:string
  expiryMonth:string
  expiryYear:string
  cvc:string
  amountCOINSPurchased:number
  amountCharge:number
  currentCurrencyID:string
  messagePayment:string
  currencyList:any
  costs:any
  investmentList:any
  investmentSelected:string
  math:any

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    private _zone:NgZone,
    public UI:UserInterfaceService
  ) {
    this.math=Math
    this.messagePayment=''
    this.investmentList=[100,500,1000,2000]
    this.investmentSelected=null
    this.currentCurrencyID='gbp'
    afs.doc<any>('appSettings/payment').valueChanges().subscribe(snapshot=>{
      this.currencyList=snapshot.currencyList
      this.refreshAmountCharge()
    })
    afs.doc<any>('appSettings/costs').valueChanges().subscribe(snapshot=>{
      this.costs=snapshot
    })
  }

  processPayment() {
    (window as any).Stripe.card.createToken({
      number:this.cardNumber,
      exp_month:this.expiryMonth,
      exp_year:this.expiryYear,
      cvc:this.cvc
    }, (status:number, response:any) => {
      this._zone.run(() => {
        if (response.error) {
          this.messagePayment = response.error.message
        } else {
          this.messagePayment = `Processing card...`
          this.afs.collection('PERRINNTeams/'+this.UI.currentUser+'/payments').add({
            source:response.id,
            amountCOINSPurchased:this.amountCOINSPurchased,
            amountCharge:this.amountCharge,
            currency:this.currentCurrencyID,
            user:this.UI.currentUser,
            serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()
          }).then(paymentID=>{
            this.afs.doc<any>('PERRINNTeams/'+this.UI.currentUser+'/payments/'+paymentID.id).valueChanges().subscribe(payment=>{
              if(payment.outcome!=undefined)this.messagePayment=payment.outcome.seller_message
              if(this.messagePayment=='Payment complete.')this.router.navigate(['chat',this.UI.currentUser])
              if(payment.errorMessage!=undefined)this.messagePayment=payment.errorMessage
            })
          })
        }
      })
    })
  }

  refreshAmountCharge() {
    this.amountCOINSPurchased=this.investmentList[this.investmentSelected]||0
    this.amountCharge=Number((this.amountCOINSPurchased/this.currencyList[this.currentCurrencyID].toCOIN*100).toFixed(0))
  }

  objectToArray(obj) {
    if (obj == null) { return [] }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]]
    })
  }

}
