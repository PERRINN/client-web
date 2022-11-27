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
  selector:'settings',
  template:`
  <div class="sheet" style="background-color:whitesmoke">
  <img class="imageWithZoom" [src]="UI.currentUserLastMessageObj?.imageUrlMedium||UI.currentUserLastMessageObj?.imageUrlThumbUser" style="object-fit:cover;margin:10px;border-radius:3px;height:200px;width:200px" (click)="showFullScreenImage(UI.currentUserLastMessageObj?.imageUrlOriginal)"
  onerror="this.onerror=null;this.src='https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1585144867972Screen%20Shot%202018-03-16%20at%2015.05.10_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=I3Kem9n6zYjSNijnKOx%2FAOUAg65GN3xf8OD1qD4uo%2BayOFblFIgfn81uPWRTzhGg14lJdyhz3Yx%2BiCXuYCIdYnduqMZcIjtHE6WR%2BPo74ckemuxIKx3N24tlBJ6DgkfgqwmIkw%2F%2FKotm8Cz%2Fq%2FbIZm%2FvAOi2dpBHqrHiIFXYb8AVYnhP1osUhVvyzapgYJEBZJcHur7v6uqrSKwQ4DfeHHinbJpvkX3wjM6Nxabi3kVABdGcGqMoAPGCTZJMzNj8xddAXuECbptQprd9LlnQOuL4tuDfLMAOUXTHmJVhJEBrquxQi8iPRjnLOvnqF8s2We0SOxprqEuwbZyxSgH05Q%3D%3D'">
  <br/>
  <div>
    <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
    <label class="buttonUploadImage" for="chatImage" id="buttonFile">
    <div style="font-size:12px;text-align:center;line-height:20px;width:250px;padding:2px;margin:10px;color:white;background-color:black;border-radius:3px;cursor:pointer">Upload a new profile picture</div>
    </label>
  </div>
  <div style="margin:15px">
    <span style="font-size:18px">{{UI.currentUserLastMessageObj?.name}} </span>
    <span style="font-size:18px">{{UI.formatCOINS(UI.currentUserLastMessageObj?.wallet?.balance||0)}} </span>
    <span *ngFor="let currency of objectToArray(currencyList);let first=first;let last=last">{{first?"(":""}}{{UI.formatCOINS((UI.currentUserLastMessageObj?.wallet?.balance||0)/currency[1].toCOIN)}} {{currency[1].code}}{{last?")":", "}}</span>
  </div>
  <span style="font-size:10px;margin-left:15px">{{UI.currentUserLastMessageObj?.userPresentation}} {{UI.currentUserLastMessageObj?.contract?.position}} Level {{UI.currentUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
  <span *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px;color:black">Waiting for contract signature ({{UI.currentUserLastMessageObj?.contract?.position}} Level {{UI.currentUserLastMessageObj?.contract?.level}})</span>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
      <div style="font-size:14px;margin:20px;color:#444">Your name (preferably your first name)</div>
      <input [(ngModel)]="name" placeholder="First name">
      <div (click)="updateName()" style="font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:black;border-radius:3px;cursor:pointer">Update my name</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px;color:#444">Your short presentation</div>
      <div style="font-size:10px;margin:20px;color:#777">Your short presentation helps other members get to know you.</div>
      <div style="color:black;font-size:10px;margin:10px 20px 0 20px">I am someone who is:</div>
      <input [(ngModel)]="userPresentation" placeholder="your short presentation" maxlength="150">
      <div (click)="updateUserPresentation()" style="font-size:12px;text-align:center;line-height:20px;width:200px;padding:2px;margin:10px;color:white;background-color:black;border-radius:3px;cursor:pointer">Update my presentation</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px;color:#444">Your email addresses</div>
      <div style="font-size:10px;margin:20px 20px 0 20px;color:#777">Use these addresses to receive notifications, connect to other PERRINN apps like Onshape, Google Drive and Google Meet (calendar events and meetings). These addresses are visible by other PERRINN members.</div>
      <div style="font-size:10px;margin:10px 20px 0 20px;color:black">Authentication address.</div>
      <input [(ngModel)]="emailsAuth" placeholder="Enter your authentication email">
      <div style="font-size:10px;margin:10px 20px 0 20px;color:black">Google address.</div>
      <input [(ngModel)]="emailsGoogle" placeholder="Enter your Google account email (optional)">
      <div style="font-size:10px;margin:10px 20px 0 20px;color:black">Onshape address.</div>
      <input [(ngModel)]="emailsOnshape" placeholder="Enter your Onshape account email (optional)">
      <div (click)="updateEmails()" style="font-size:12px;text-align:center;line-height:20px;width:250px;padding:2px;margin:10px;color:white;background-color:black;border-radius:3px;cursor:pointer">Update my email addresses</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px;color:#444">Your PERRINN contract</div>
      <div style="font-size:10px;margin:20px;color:#777">This contract is between you and PERRINN team. New Shares are credited to you based on the settings below. When these settings are updated, they will need to be approved before taking effect. You or PERRINN can cancel this contract at any time.</div>
      <div style="color:black;font-size:10px;margin:15px 20px 0 20px">Position as specific as possible so other members understand your role in the team.</div>
      <input [(ngModel)]="contract.position" placeholder="Contract position">
      <div style="color:black;font-size:10px;margin:15px 20px 0 20px">Level [1-10] defines the level of experience / capacity to resolve problems independently. Level 1 is university student with no experience, 10 is expert (10+ years experience in the field). After signature your level will increase automatically with time at a rate of +1 per year.</div>
      <input [(ngModel)]="contract.level" placeholder="Contract level">
      <div *ngIf="!UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px;color:black">No contract registered.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px;color:black">Contract number {{UI.currentUserLastMessageObj?.contract?.createdTimestamp}}</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px;color:black">Signature valid for level {{UI.currentUserLastMessageObj?.contract?.signedLevel}}, you will receive {{UI.currentUserLastMessageObj?.contract?.hourlyRate|number:'1.1-1'}} Shares per hour when you declare working hours.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px;color:black">Waiting for contract signature</div>
      <div (click)="updateContract()" style="clear:both;font-size:12px;text-align:center;line-height:20px;width:150px;padding:2px;margin:10px;color:white;background-color:black;border-radius:3px;cursor:pointer">Update my contract</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
  <div class="buttonDiv" style="color:white;background-color:red;margin-top:25px;margin-bottom:25px" (click)="this.logout();router.navigate(['login']);">logout</div>
  <div class="seperator" style="width:100%;margin-bottom:250px"></div>
  `,
})
export class SettingsComponent {
  editMembers:boolean
  name:string
  userPresentation:string
  emailsAuth:string
  emailsGoogle:string
  emailsOnshape:string
  contract:any
  searchFilter:string
  currencyList:any

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    private storage:AngularFireStorage,
    public UI:UserInterfaceService
  ) {
    this.contract={}
    this.editMembers=false
    this.name=this.UI.currentUserLastMessageObj.name
    this.userPresentation=this.UI.currentUserLastMessageObj.userPresentation||null
    this.emailsAuth=this.UI.currentUserLastMessageObj.emails.auth||null
    this.emailsGoogle=this.UI.currentUserLastMessageObj.emails.google||null
    this.emailsOnshape=this.UI.currentUserLastMessageObj.emails.onshape||null
    this.contract.position=(this.UI.currentUserLastMessageObj.contract||{}).position||null
    this.contract.level=(this.UI.currentUserLastMessageObj.contract||{}).level||null
    afs.doc<any>('appSettings/payment').valueChanges().subscribe(snapshot=>{
      this.currencyList=snapshot.currencyList
    })
  }

  logout() {
    this.afAuth.auth.signOut();
    this.UI.currentUser = null;
  }

  updateName(){
    if(!this.name)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my name to '+this.name,
      name:this.name
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  updateUserPresentation(){
    if(!this.userPresentation)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my presentation to '+this.userPresentation,
      userPresentation:this.userPresentation
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  updateEmails(){
    if(this.emailsAuth!=this.UI.currentUserLastMessageObj.emails.auth
      ||this.emailsGoogle!=this.UI.currentUserLastMessageObj.emails.google
      ||this.emailsOnshape!=this.UI.currentUserLastMessageObj.emails.onshape
    ){
      this.UI.createMessage({
        chain:this.UI.currentUser,
        text:'Updating my email addresses.',
        emails:{
          auth:this.emailsAuth,
          google:this.emailsGoogle,
          onshape:this.emailsOnshape
        }
      })
      this.router.navigate(['chat',this.UI.currentUser])
      return
    }
    else return
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
