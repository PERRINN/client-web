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
  <div class="sheet" style="background-color:black">
    <div style="margin:15px">
      <span style="font-size:12px">{{UI.PERRINNAdminLastMessageObj?.statistics?.emailsContributorsAuth?.length}} members own {{UI.formatSharesToPRNCurrency(null,UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance)}}.</span>
    </div>
  <div class="separator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
  <ul class="listLight">
    <li *ngFor="let message of messages | async">
      <div (click)="router.navigate(['profile',message.values.user])">
        <img [src]="message?.values.imageUrlThumbUser" style="float:left;margin:10px;opacity:1;object-fit:cover;height:50px;width:50px">
        <div style="float:left;padding:10px;width:55%">
          <div>{{message.values?.name}}</div>
          <span *ngIf="message.values?.publicLink" class="material-icons-outlined" style="font-size:18px;line-height:10px">link</span>
          <span style="font-size:10px"> {{message.values?.userPresentation}}</span>
          <span *ngIf="message.values?.contract?.signed" style="font-size:10px"> Level {{message.values?.contract?.levelTimeAdjusted|number:'1.1-1'}}.</span>
        </div>
        <div style="float:right;margin:10px;width:60px">
          <div>{{UI.formatSharesToPRNCurrency(null,message.values?.wallet?.balance||0)}}</div>
          <div *ngIf="((message.values?.wallet?.balance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance))>0.001" style="font-size:10px">{{((message.values?.wallet?.balance||0)/(UI.PERRINNAdminLastMessageObj?.statistics?.wallet?.balance))|percent:'1.1-1'}}</div>
        </div>
      </div>
      <div class="separator"></div>
    </li>
  </ul>
  <div class="separator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <img [src]="UI.PERRINNProfileLastMessageObj?.imageUrlOriginal" style="float:left;object-fit:cover;width:100%">
    <li *ngFor="let message of messages | async" style="float:left" (click)="router.navigate(['profile',message.values.user])">
      <img [src]="message?.values.imageUrlThumbUser" style="float:left;object-fit:cover;height:77px;width:77px">
    </li>
  </ul>
  <div class="separator" style="width:100%;margin:0px;cursor:default"></div>
  <ul class="listLight" style="margin:10px">
    <li *ngFor="let message of messages | async" style="float:left;cursor:text;user-select:text">
      <span>{{message.values?.name}} </span>
      <span>{{UI.formatSharesToPRNCurrency(null,message.values?.wallet?.balance||0)}}&nbsp;&nbsp;</span>
    </li>
  </ul>
  <div class="separator" style="width:100%;margin:0px"></div>
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
  ){}

  ngOnInit() {
    this.refreshMembersList()
  }

  refreshMembersList() {
    this.messages = this.afs.collection('PERRINNMessages', ref => ref
    .where('userChain.nextMessage','==','none')
    .where('verified','==',true)
    .where('wallet.balance','>',0)
    .orderBy('wallet.balance',"desc")
    .limit(200))
    .snapshotChanges().pipe(map(changes => {
      return changes.map(c => ({
        key:c.payload.doc.id,
        values:c.payload.doc.data(),
      }));
    }));
  }

}
