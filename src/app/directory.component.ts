import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth'
import firebase from 'firebase/compat/app';

@Component({
  selector:'directory',
  template:`
  <div class="sheet" style="background-color:whitesmoke">
    <div style="margin:15px">
      <span style="font-size:12px">PERRINN members are PERRINN Limited UK ({{UI.PERRINNAdminLastMessageObj?.statistics?.PERRINNLimited?.balance/UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance|percent:'1.0-0'}} of all deposits) and our public community ({{1-(UI.PERRINNAdminLastMessageObj?.statistics?.PERRINNLimited?.balance/UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance)|percent:'1.0-0'}} of all deposits).</span>
      <br>
      <span style="font-size:12px">{{UI.formatSharesToCurrency(null,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance)}} is currently deposited by our members.</span>
    </div>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
  <ul class="listLight">
    <li *ngFor="let message of messages | async">
      <div (click)="router.navigate(['profile',message.values.user])">
        <img [src]="message?.values.imageUrlThumbUser" style="float:left;margin:10px;opacity:1;object-fit:cover;height:50px;width:50px;border-radius:50%">
        <div style="float:left;padding:10px;width:20%">
          <div style="font-weight:bold">{{message.values?.name}}</div>
        </div>
        <div style="float:left;padding:10px;width:45%">
          <span style="font-size:10px"> {{message.values?.userPresentation}}</span>
          <span *ngIf="message.values?.contract?.signed" style="font-size:10px"> Level {{message.values?.contract?.levelTimeAdjusted|number:'1.1-1'}}.</span>
          <span *ngIf="message.values?.PERRINNLimited?.amount>0" style="font-size:10px"> {{UI.formatSharesToCurrency(null,message.values?.PERRINNLimited?.amount-message.values?.PERRINNLimited?.zeroInterestLoan1)}} from PERRINN Limited ownership.</span>
          <span *ngIf="message.values?.PERRINNLimited?.zeroInterestLoan1>0" style="font-size:10px"> {{UI.formatSharesToCurrency(null,message.values?.PERRINNLimited?.zeroInterestLoan1)}} from PERRINN Limited loan.</span>
          <span *ngIf="message.values?.PERRINNLimited?.amount>0&&message.values?.wallet?.balance>0" style="font-size:10px"> {{UI.formatSharesToCurrency(null,message.values?.wallet?.balance)}} from membership.</span>
        </div>
        <div style="float:right;margin:10px;width:50px">
          <div>{{UI.formatSharesToCurrency(null,message.values?.wallet?.shareBalance||0)}}</div>
          <div style="font-size:10px">{{((message.values?.wallet?.shareBalance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.shareBalance))|percent:'1.1-1'}}</div>
        </div>
      </div>
      <div class="seperator"></div>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:default">
      <img [src]="message?.values.imageUrlThumbUser" style="float:left;opacity:1;object-fit:cover;height:50px;width:50px">
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:text;user-select:text">
      <span>{{message.values?.name}} </span>
      <span>{{UI.formatSharesToCurrency(null,message.values?.wallet?.shareBalance||0)}}&nbsp;&nbsp;</span>
    </li>
  </ul>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  `,
})

export class DirectoryComponent  {

  messages:Observable<any[]>;

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    public UI:UserInterfaceService
  ){
    this.afAuth.user.subscribe((auth) => {
      if (auth == null) {
        this.router.navigate(['login'])
      }
    })
  }

  ngOnInit() {
    this.refreshMembersList();
  }

  refreshMembersList() {
    this.messages = this.afs.collection('PERRINNMessages', ref => ref
    .where('userChain.nextMessage','==','none')
    .where('verified','==',true)
    .where('wallet.shareBalance','>',0)
    .orderBy('wallet.shareBalance',"desc")
    .limit(100))
    .snapshotChanges().pipe(map(changes => {
      return changes.map(c => ({
        key:c.payload.doc.id,
        values:c.payload.doc.data(),
      }));
    }));
  }

}
