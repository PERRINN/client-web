import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';

@Component({
  selector: 'app-root',
  template: `
    <img class="fullScreenImage" id="fullScreenImage" (click)="hideFullScreenImage()">
    <progress value='0' max='100' id='uploader'>0%</progress>
    <div class='menu'>
      <div style="width:320px;display:block;margin: 0 auto">
        <img src="./../assets/App icons/Perrinn_02.png" style="cursor:pointer;float:left;width:30px;margin:5px 45px 5px 5px;border-radius:3px;" (click)="router.navigate(['profile','channel'+UI.currentChannel])">
        <span class="material-icons" style="float:left;margin:5px 45px 5px 45px;font-size:30px;cursor:pointer;color:white" (click)="router.navigate(['directory'])">list</span>
        <span class="material-icons-outlined" style="float:left;margin:5px 45px 5px 45px;font-size:30px;height:30px;cursor:pointer;color:white" onclick="window.open('https://discover.perrinn.com','_blank')">info</span>
      </div>
    </div>
    <div style="user-select:none">
      <div *ngIf="UI.currentUser" style="max-width:800px;margin:0 auto">
        <div style="float:left;width:110px;height:35px;cursor:pointer;border-style:solid;border-width:0 1px 0 0;border-color:#ddd" (click)="router.navigate(['profile',UI.currentUser])">
          <img *ngIf="UI.currentUserLastMessageObj?.imageUrlThumbUser" [src]="UI.currentUserLastMessageObj.imageUrlThumbUser" style="display:inline;float:left;margin:4px;border-radius:50%;object-fit:cover;width:25px;height:25px">
          <div *ngIf="UI.currentUserLastMessageObj?.wallet?.balance" style="float:left;margin:8px;font-size:12px">
            <span style="font-size:8px;font-style:italic">424 </span>
            <span >{{UI.formatCOINS(UI.currentUserLastMessageObj.wallet.balance)}}</span>
          </div>
        </div>
        <span class="material-icons" style="float:right;margin:5px;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="showApps=!showApps">apps</span>
        <div style="float:right;height:35px;cursor:pointer;border-style:solid;border-width:0 1px 0 0;border-color:#ddd" (click)="showChannels=!showChannels">
          <div style="float:left;margin:8px;font-size:12px;font-weight:bold">
            {{UI.currentChannelLastMessageObj?.channelName||'Channels'}}
          </div>
          <img *ngIf="UI.currentChannelLastMessageObj?.channelImageUrlMedium" [src]="UI.currentChannelLastMessageObj?.channelImageUrlMedium" style="float:left;object-fit:cover;height:35px;width:140px">
        </div>
        <span class="material-icons" style="float:left;margin:5px;cursor:pointer;color:rgba(0,0,0,0.6)" (click)="newMessage()">create</span>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div class='sheet' *ngIf="showApps">
      <div style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" (click)="showApps=false;showChannels=false;router.navigate(['settings'])">
        <span class="material-icons" style="margin:5px;cursor:pointer;color:rgba(0,0,0,0.6)">settings</span>
        <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Settings</div>
      </div>
      <div *ngIf="UI.currentUserLastMessageObj?.wallet?.balance>0" style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="showApps=false;showChannels=false;window.open('https://meet.google.com/rxn-vtfa-shq','_blank')">
        <img style="width:22px;margin:5px 8px 5px 8px;margin-top:11px;filter:grayscale(100%)" src="./../assets/App icons/google-meet-logo.png">
        <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Meet</div>
      </div>
      <div *ngIf="UI.currentUserLastMessageObj?.wallet?.balance>0" style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="showApps=false;showChannels=false;window.open('https://drive.google.com/drive/u/1/folders/1qvipN1gs1QS4sCh1tY8rSSFXV5S0-uR3','_blank')">
        <img style="width:22px;margin:5px 8px 5px 8px;margin-top:9px;filter:grayscale(100%)" src="./../assets/App icons/Google_Drive_icon_(2020).svg">
        <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Documents</div>
      </div>
      <div *ngIf="UI.currentUserLastMessageObj?.wallet?.balance>0" style="float:left;width:100px;text-align:center;cursor:pointer;margin:10px;border-style:solid;border-width:1px;border-color:#ddd" onclick="showApps=false;showChannels=false;window.open('https://cad.onshape.com/documents?nodeId=31475a51a48fbcc9cfc7e244&resourceType=folder','_blank')">
        <img style="width:24px;margin:5px 8px 5px 8px;filter:grayscale(100%)" src="./../assets/App icons/onshape_new.png">
        <div style="width:100px;font-size:12px;font-weight:bold;padding:3px">Design</div>
      </div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div class='sheet' *ngIf="UI.currentChannel==undefined||showChannels">
      <ul class="listLight">
        <li *ngFor="let message of UI.channels|async;let first=first;let last=last"
          style="float:left;margin:10px;border-style:solid;border-width:1px;border-color:#ddd"
          (click)="UI.currentChannel=message.payload.doc.data()?.channel;UI.currentChannelLastMessageObj=message.payload.doc.data();showChannels=false;showApps=false;router.navigate(['profile','channel'+UI.currentChannel])">
          <img [src]="message.payload.doc.data()?.channelImageUrlMedium" style="object-fit:cover;height:75px;width:300px">
          <div style="width:300px;text-align:center;font-size:12px;font-weight:bold;padding:3px">{{message.payload.doc.data()?.channelName}}</div>
        </li>
      </ul>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
    <div id='main_container'>
      <router-outlet></router-outlet>
    </div>
  `,
})
export class AppComponent {
  showChannels:boolean
  showApps:boolean

  constructor(
    public router:Router,
    public afs:AngularFirestore,
    public UI:UserInterfaceService
  ) {
    localStorage.clear()
    this.showChannels=false
    this.showApps=false
  }

  ngOnInit() {
    document.getElementById('uploader').style.visibility = 'hidden';
    document.getElementById('fullScreenImage').style.visibility = 'hidden';
  }

  hideFullScreenImage() {
    const fullScreenImage = document.getElementById('fullScreenImage') as HTMLImageElement;
    fullScreenImage.style.visibility = 'hidden';
    fullScreenImage.src = '';
  }

  newMessage() {
    this.router.navigate(['chat',this.UI.newId()])
  }

}
