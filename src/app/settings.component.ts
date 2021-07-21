import { Component } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router, ActivatedRoute } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFireStorage } from '@angular/fire/storage';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import * as firebase from 'firebase/app';

@Component({
  selector: 'settings',
  template: `
  <div class="sheet" style="background-color:whitesmoke">
  <img class="imageWithZoom" [src]="UI.currentUserLastMessageObj?.imageUrlMedium||UI.currentUserLastMessageObj?.imageUrlThumbUser" style="object-fit:cover;margin:10px;border-radius:3px;max-height:150px;width:50%" (click)="showFullScreenImage(UI.currentUserLastMessageObj?.imageUrlOriginal)"
  onerror="this.onerror=null;this.src='https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1585144867972Screen%20Shot%202018-03-16%20at%2015.05.10_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=I3Kem9n6zYjSNijnKOx%2FAOUAg65GN3xf8OD1qD4uo%2BayOFblFIgfn81uPWRTzhGg14lJdyhz3Yx%2BiCXuYCIdYnduqMZcIjtHE6WR%2BPo74ckemuxIKx3N24tlBJ6DgkfgqwmIkw%2F%2FKotm8Cz%2Fq%2FbIZm%2FvAOi2dpBHqrHiIFXYb8AVYnhP1osUhVvyzapgYJEBZJcHur7v6uqrSKwQ4DfeHHinbJpvkX3wjM6Nxabi3kVABdGcGqMoAPGCTZJMzNj8xddAXuECbptQprd9LlnQOuL4tuDfLMAOUXTHmJVhJEBrquxQi8iPRjnLOvnqF8s2We0SOxprqEuwbZyxSgH05Q%3D%3D'">
  <br/>
  <span style="font-size:18px;line-height:30px;margin:15px">{{UI.currentUserLastMessageObj?.name}} {{UI.formatCOINS(UI.currentUserLastMessageObj?.wallet?.balance||0)}}</span>
  <br/>
  <span *ngIf="UI.currentUserLastMessageObj?.userStatus?.isMember" style="font-size:10px;margin-left:15px">Member</span>
  <span *ngIf="UI.currentUserLastMessageObj?.userStatus?.isDeveloper" style="font-size:10px"> Developer ({{UI.currentUserLastMessageObj?.contract?.position}} Level {{UI.currentUserLastMessageObj?.contract?.level}})</span>
  <span *ngIf="UI.currentUserLastMessageObj?.userStatus?.isInvestor" style="font-size:10px"> Investor</span>
  <span *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px;color:midnightblue">Waiting for contract signature ({{UI.currentUserLastMessageObj?.contract?.position}} Level {{UI.currentUserLastMessageObj?.contract?.level}})</span>
  <div style="font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:green;border-radius:3px;cursor:pointer" (click)="router.navigate(['buyCoins'])">Buy new COINS</div>
  <br/>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
    <div>
      <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
      <label class="buttonUploadImage" for="chatImage" id="buttonFile">
      <div style="font-size:12px;text-align:center;line-height:20px;width:250px;padding:2px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer">Upload new profile picture</div>
      </label>
    </div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <input [(ngModel)]="name" placeholder="First name">
      <div (click)="updateName()" style="font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer">Update name</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px;color:#444">Your PERRINN email</div>
      <div style="font-size:10px;margin:20px;color:#777">Use this email to receive notifications, connect to other PERRINN apps like Onshape, Google Drive and Google Meet (calendar events and meetings). This email can be the one you use to log into PERRINN.com or any other email. This email is visible by other PERRINN members.</div>
      <input [(ngModel)]="currentEmail" placeholder="Enter your PERRINN email">
      <div (click)="updateEmail()" style="font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer">Update email</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px;color:#444">Your PERRINN contract</div>
      <div style="font-size:10px;margin:20px;color:#777">This contract is between you and PERRINN team. New COINS are credited to you based on the settings below. When these settings are updated, they will need to be approved before taking effect. You or PERRINN can cancel this contract at any time.</div>
      <div style="color:midnightblue;font-size:10px;margin:15px 0 0 15px">Position: as specific as possible so other members understand your role in the team.</div>
      <input [(ngModel)]="contract.position" placeholder="Contract position">
      <div style="color:midnightblue;font-size:10px;margin:15px 0 0 15px">Level: [1-10] defines the level of experience / capacity to resolve problems independently. Level 1 is university student with no experience, 10 is expert (10+ years experience in the field).</div>
      <input [(ngModel)]="contract.level" placeholder="Contract level">
      <div *ngIf="!UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px;color:midnightblue">No contract registered.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px;color:midnightblue">Contract number: {{UI.currentUserLastMessageObj?.contract?.createdTimestamp}}</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px;color:midnightblue">Signature valid for level {{UI.currentUserLastMessageObj?.contract?.signedLevel}}, you will receive {{UI.currentUserLastMessageObj?.contract?.rateDay}} COINS per day when you post messages in your log.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px;color:midnightblue">Waiting for contract signature</div>
      <div (click)="updateContract()" style="clear:both;font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:midnightblue;border-radius:3px;cursor:pointer">Update contract</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
  <div class="buttonDiv" style="color:white;background-color:red;margin-top:25px;margin-bottom:25px" (click)="this.logout();router.navigate(['login']);">logout</div>
  <div class="seperator" style="width:100%;margin-bottom:250px"></div>
  `,
})
export class SettingsComponent {
  editMembers:boolean
  name:string
  currentEmail:string
  contract:any
  searchFilter:string

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private storage: AngularFireStorage,
    public UI: UserInterfaceService
  ) {
    this.contract={}
    this.editMembers=false
    this.name=this.UI.currentUserLastMessageObj.name
    this.currentEmail=this.UI.currentUserLastMessageObj.userEmail||null
    this.contract.position=(this.UI.currentUserLastMessageObj.contract||{}).position||null
    this.contract.level=(this.UI.currentUserLastMessageObj.contract||{}).level||null
  }

  logout() {
    this.afAuth.auth.signOut();
    this.UI.currentUser = null;
  }

  updateName(){
    if(!this.name)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my name to: '+this.name,
      name:this.name
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  updateEmail(){
    if(!this.currentEmail)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my email to: '+this.currentEmail,
      userEmail:this.currentEmail
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  updateContract(){
    if(!this.contract.position||!this.contract.level)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my contract details to position '+this.contract.position+', level '+this.contract.level,
      contract:{
        position:this.contract.position,
        level:this.contract.level
      }
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  addChild(team){
  }

  showFullScreenImage(src) {
    const fullScreenImage = document.getElementById('fullScreenImage') as HTMLImageElement;
    fullScreenImage.src = src;
    fullScreenImage.style.visibility = 'visible';
  }

  onImageChange(event:any) {
    const image = event.target.files[0];
    const uploader = document.getElementById('uploader') as HTMLInputElement;
    const storageRef = this.storage.ref('images/'+Date.now()+image.name);
    const task = storageRef.put(image);

    task.snapshotChanges().subscribe((snapshot) => {
      document.getElementById('buttonFile').style.visibility = 'hidden';
      document.getElementById('uploader').style.visibility = 'visible';

      const percentage = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      uploader.value = percentage.toString();
    },
    (err:any) => {
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      uploader.value = '0';
    },
    () => {
      uploader.value = '0';
      document.getElementById('buttonFile').style.visibility = 'visible';
      document.getElementById('uploader').style.visibility = 'hidden';
      let imageTimestamp = task.task.snapshot.ref.name.substring(0, 13);
      storageRef.getDownloadURL().subscribe(url => {
        this.UI.createMessage({
          chain:this.UI.currentUser,
          text:'updating my profile picture',
          userImageTimestamp:imageTimestamp,
          chatImageTimestamp:imageTimestamp,
          chatImageUrlThumb:url,
          chatImageUrlMedium:url,
          chatImageUrlOriginal:url,
          imageUrlOriginal:url
        })
        this.router.navigate(['chat',this.UI.currentUser])
      });
    });
  }

  objectToArray(obj) {
    if (obj == null) { return []; }
    return Object.keys(obj).map(function(key) {
      return [key, obj[key]];
    });
  }

}
