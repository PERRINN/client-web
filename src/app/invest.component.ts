import {AfterViewInit,ChangeDetectorRef,ElementRef,Inject,OnDestroy,ViewChild} from '@angular/core'
import { Component, NgZone } from '@angular/core'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Router } from '@angular/router'
import { UserInterfaceService } from './userInterface.service'
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore'
import firebase from 'firebase/compat/app'

@Component({
  selector:'invest',
  template:`
  <div class='sheet'>
  <br>
  <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div *ngIf="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal!=undefined" style="clear:both">
      <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="width:100%">
    </div>
    <div style="padding:10px;text-align:center">
      <span style="font-size:12px">To invest into PERRINN 424, purchase digital Shares here.</span>
      <br>
      <span style="font-size:12px">PERRINN has </span>
      <span style="font-size:15px">{{UI.PERRINNAdminLastMessageObj?.statistics?.emailsMembersAuth?.length}}</span>
      <span style="font-size:12px"> investors and </span>
      <span style="font-size:15px">{{UI.formatShares(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance)}}</span>
      <span style="font-size:12px"> Shares distributed.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">Investment</div>
    <div class="seperator"></div>
    <div style="padding:10px;text-align:center">
      <span class="material-icons-outlined" style="font-size:30px">verified</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> Your Shares are backed by the network we are developing.</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> Your investment is going into PERRINN 424 development.</span>
      <br>
      <span class="material-icons" style="font-size:15px;line-height:8px">done</span>
      <span style="font-size:12px"> You can follow the impact of your investment live on PERRINN.com.</span>
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
      <span style="font-size:10px">(&#42;) When 424 realises a profit through commercial rights, all investors will be offered the opportunity to sell some of their Shares back to PERRINN.</span>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">How many Shares do you want to purchase?</div>
    <div style="padding:10px">
      <ul class="listLight">
        <li *ngFor="let investment of investmentList;let index=index"
          (click)="investmentSelected=index;refreshAmountCharge()"
          style="float:left;width:63px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
          [style.background-color]="investmentSelected==index?'black':'white'"
          [style.color]="investmentSelected==index?'white':'black'"
          [style.border-style]="investmentSelected==index?'none':'solid'"
          [style.border-width]="investmentSelected==index?'none':'1px'">
          {{investment|number:'1.2-2'}} Shares
        </li>
      </ul>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="sheet" style="width:500px;max-width:80%;border-radius:3px">
    <div class="seperator"></div>
    <div class="title" style="background-color:whitesmoke">Which currency do you want to pay with?</div>
    <div style="padding:10px">
      <ul class="listLight">
        <li *ngFor="let currency of objectToArray(currencyList)"
          (click)="currencySelected=currency[0];refreshAmountCharge()"
          style="float:left;width:125px;padding:5px;margin:5px;text-align:center;font-size:10px;border-radius:3px"
          [style.background-color]="currencySelected==currency[0]?'black':'white'"
          [style.color]="currencySelected==currency[0]?'white':'black'"
          [style.border-style]="currencySelected==currency[0]?'none':'solid'"
          [style.border-width]="currencySelected==currency[0]?'none':'1px'">
          {{currency[1].designation}}
        </li>
      </ul>
      <div style="font-size:10px;padding:10px">1 Share costs {{1/currencyList[currencySelected].toCOIN|number:'1.2-2'}} {{currencyList[currencySelected].code}}</div>
    </div>
    <div class="seperator"></div>
  </div>
  <br>
  <div class="module form-module" style="width:500px;max-width:80%;border-style:solid;border-width:1px;border-color:#ddd;border-radius:3px">
  <div class="title" style="background-color:whitesmoke">Credit or debit card</div>
  <div class="form">
    <form (ngSubmit)="createStripeToken()" class="checkout">
      <div id="form-field">
        <div id="card-info" #cardElement></div>
        <br>
        <div class="title">You are purchasing {{amountSharesPurchased|number:'1.2-2'}} Shares</div>
        <button *ngIf="!processing" id="submit-button" type="submit">
            Pay {{amountCharge/100 | number:'1.2-2'}} {{currencySelected | uppercase}}
        </button>
        <br>
        <mat-error id="card-errors" role="alert" *ngIf="stripeMessage">
            &nbsp;{{ stripeMessage }}
        </mat-error>
      </div>
    </form>
  </div>
  <div class="seperator"></div>
  <div style="float:right"><img src="./../assets/App icons/poweredByStripe2.png" style="width:175px"></div>
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
  amountSharesPurchased:number
  amountCharge:number
  currencyList:any
  currencySelected:string
  costs:any
  investmentList:any
  investmentSelected:number
  math:any
  card:any
  cardHandler=this.onChange.bind(this)
  stripeMessage:string
  @ViewChild('cardElement') cardElement:ElementRef
  processing:boolean

  constructor(
    public afs:AngularFirestore,
    public router:Router,
    private _zone:NgZone,
    public UI:UserInterfaceService,
    private cd: ChangeDetectorRef,
  ) {
    this.processing=false
    this.math=Math
    this.investmentList=[100,300,1000,3000]
    this.investmentSelected=0
    this.currencySelected='usd'
    afs.doc<any>('appSettings/payment').valueChanges().subscribe(snapshot=>{
      this.currencyList=snapshot.currencyList
      this.refreshAmountCharge()
    })
    afs.doc<any>('appSettings/costs').valueChanges().subscribe(snapshot=>{
      this.costs=snapshot
    })
  }

  ngAfterViewInit(){
    this.card=elements.create('card')
    this.card.mount(this.cardElement.nativeElement)
    this.card.addEventListener('change',this.cardHandler)
  }

  ngOnDestroy() {
    if (this.card) {
        this.card.destroy()
    }
  }

  onChange({error}) {
    if(error)this.stripeMessage=error.message
    else this.stripeMessage=null
    this.cd.detectChanges()
  }
  async createStripeToken(){
    this.processing=true
    const {token,error}=await stripe.createToken(this.card)
    if(token)this.onSuccess(token)
    else this.onError(error)
  }
  onSuccess(token){
    this.card.destroy()
    this.stripeMessage="processing payment"
    this.afs.collection('PERRINNTeams/'+this.UI.currentUser+'/payments').add({
      source:token.id,
      amountSharesPurchased:this.amountSharesPurchased,
      amountCharge:this.amountCharge,
      currency:this.currencySelected,
      user:this.UI.currentUser,
      serverTimestamp:firebase.firestore.FieldValue.serverTimestamp()
    }).then(chargeID=>{
      this.afs.doc<any>('PERRINNTeams/'+this.UI.currentUser+'/payments/'+chargeID.id).valueChanges().subscribe(payment=>{
        if(payment.outcome!=undefined)this.stripeMessage=payment.outcome.seller_message
        if(this.stripeMessage=='Payment complete.')this.router.navigate(['chat',this.UI.currentUser])
        if(payment.errorMessage!=undefined)this.stripeMessage=payment.errorMessage
      })
    })
  }
  onError(error){
    this.processing=false
    if(error.message)this.stripeMessage=error.message
  }

  refreshAmountCharge() {
    this.amountSharesPurchased=this.investmentList[this.investmentSelected]||0
    this.amountCharge=Number((this.amountSharesPurchased/this.currencyList[this.currencySelected].toCOIN*100).toFixed(0))
  }

  objectToArray(obj) {
    if (obj == null) { return [] }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]]
    })
  }

}
