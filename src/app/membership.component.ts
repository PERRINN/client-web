import { Component, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import * as firebase from 'firebase/app';

@Component({
  selector:'membership',
  template:`
  <div class='sheet'>
  <br>
  <div class="sheet" style="max-width:320px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">Membership</div>
    <div style="color:white;background-color:midnightblue;padding:10px;text-align:center">
      <span style="font-size:12px">To be a member you need</span>
      <br>
      <span style="font-size:20px">{{membership?.amountRequired|number:'1.1-1'}}</span>
      <span style="font-size:14px"> COINS</span>
      <br>
      <span style="font-size:12px">in your wallet</span>
    </div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:10px">Your membership will never expire.</span>
    </div>
    <div *ngIf="UI.currentUserLastMessageObj?.userStatus?.isMember" class="seperator"></div>
    <div *ngIf="UI.currentUserLastMessageObj?.userStatus?.isMember" style="padding:10px;text-align:center">
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:10px"> Your membership is active.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="max-width:320px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">Investment</div>
    <div style="color:white;background-color:midnightblue;padding:10px;text-align:center">
      <span style="font-size:12px">Your COIN balance increases automatically by</span>
      <br>
      <span style="font-size:20px">{{membership?.amountRequiredIncreaseRate|percent:'0.0'}}</span>
      <span style="font-size:10px"> a year</span>
    </div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:10px">The COINS your are placing in your wallet today are invested. You can track the interests added to your wallet every day. You will be able to sell your COINS back at a later stage realising a return.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="max-width:320px">
    <div class="seperator"></div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:10px">How many COINS do you want to purchase?</span>
    </div>
    <div style="padding:10px">
      <ul class="listLight">
        <li *ngFor="let investment of investmentList;let index=index"
          (click)="investmentSelected==index?investmentSelected=null:investmentSelected=index;refreshAmountCharge()"
          style="float:left;width:63px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
          [style.background-color]="investmentSelected==index?'midnightblue':'white'"
          [style.color]="investmentSelected==index?'white':'midnightblue'"
          [style.border-style]="investmentSelected==index?'none':'solid'"
          [style.border-width]="investmentSelected==index?'none':'1px'">
          {{index==0?'Minimum':investment|number:'1.1-1'}} COINS
        </li>
      </ul>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="max-width:320px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">You are purchasing {{amountCOINSPurchased|number:'1.1-1'}} COINS</div>
    <div class="seperator"></div>
    <div class="title">Select your currency</div>
    <ul class="listLight">
      <li *ngFor="let currency of objectToArray(currencyList)"
        [class.selected]="currency[0] === currentCurrencyID"
        (click)="currentCurrencyID = currency[0];refreshAmountCharge()"
        style="padding:15px">
        <div style="width:250px;height:20px;float:left;font-size:15px">{{currency[1].designation}}</div>
        <div style="height:20px;float:left;font-size:10px">1 COIN costs {{1/currency[1].toCOIN|number:'1.2-2'}} {{currency[1].code}}</div>
      </li>
    </ul>
  </div>
  <div class="module form-module" style="border-style:solid;border-width:1px;border-color:#ddd">
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
  <div class='sheet' style="max-width:320px">
    <div class='content' style="text-align:center">{{messagePayment}}</div>
    <div class="seperator"></div>
  </div>
  </div>
  `,
})
export class membershipComponent {
  cardNumber:string
  expiryMonth:string
  expiryYear:string
  cvc:string
  amountCOINSPurchased:number
  amountCharge:number
  currentCurrencyID:string
  messagePayment:string
  currencyList:any
  membership:any
  investmentList:any
  investmentSelected:string

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    private _zone:NgZone,
    public UI:UserInterfaceService
  ) {
    this.math=Math
    this.messagePayment=''
    this.investmentList=[0,500,1000,2000]
    this.investmentSelected=null
    this.currentCurrencyID='gbp'
    afs.doc<any>('appSettings/payment').valueChanges().subscribe(snapshot=>{
      this.currencyList=snapshot.currencyList
      this.refreshAmountCharge()
    })
    afs.doc<any>('appSettings/membership').valueChanges().subscribe(snapshot=>{
      this.membership=snapshot.membership
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
    if(this.investmentSelected==0)this.amountCOINSPurchased=Math.ceil(this.membership.amountRequired)||0
    else this.amountCOINSPurchased=this.investmentList[this.investmentSelected]||0
    this.amountCharge=Number((this.amountCOINSPurchased/this.currencyList[this.currentCurrencyID].toCOIN*100).toFixed(0))
  }

  objectToArray(obj) {
    if (obj == null) { return [] }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]]
    })
  }

}
