import { Component } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router, ActivatedRoute } from '@angular/router';
import { UserInterfaceService } from './userInterface.service';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

@Component({
  selector:'settings',
  template:`
  <div class="sheet" style="background-color:black">
  <img class="imageWithZoom" [src]="UI.currentUserLastMessageObj?.imageUrlMedium||UI.currentUserLastMessageObj?.imageUrlThumbUser" style="object-fit:cover;margin:10px;height:200px;width:200px" (click)="UI.showFullScreenImage(UI.currentUserLastMessageObj?.imageUrlOriginal)"
  onerror="this.onerror=null;this.src='https://storage.googleapis.com/perrinn-d5fc1.appspot.com/images%2F1585144867972Screen%20Shot%202018-03-16%20at%2015.05.10_180x180.png?GoogleAccessId=firebase-adminsdk-rh8x2%40perrinn-d5fc1.iam.gserviceaccount.com&Expires=16756761600&Signature=I3Kem9n6zYjSNijnKOx%2FAOUAg65GN3xf8OD1qD4uo%2BayOFblFIgfn81uPWRTzhGg14lJdyhz3Yx%2BiCXuYCIdYnduqMZcIjtHE6WR%2BPo74ckemuxIKx3N24tlBJ6DgkfgqwmIkw%2F%2FKotm8Cz%2Fq%2FbIZm%2FvAOi2dpBHqrHiIFXYb8AVYnhP1osUhVvyzapgYJEBZJcHur7v6uqrSKwQ4DfeHHinbJpvkX3wjM6Nxabi3kVABdGcGqMoAPGCTZJMzNj8xddAXuECbptQprd9LlnQOuL4tuDfLMAOUXTHmJVhJEBrquxQi8iPRjnLOvnqF8s2We0SOxprqEuwbZyxSgH05Q%3D%3D'">
  <br/>
  <div>
    <input type="file" name="chatImage" id="chatImage" class="inputfile" (change)="onImageChange($event)" accept="image/*">
    <label class="buttonUploadImage" for="chatImage" id="buttonFile">
    <div class="buttonWhite" style="font-size:12px;text-align:center;width:250px;padding:2px;margin:10px">Upload a new profile picture</div>
    </label>
  </div>
  <div style="margin:15px">
    <span style="font-size:18px">{{UI.currentUserLastMessageObj?.name}} </span>
    <span style="font-size:18px">{{UI.formatSharesToPRN(UI.currentUserLastMessageObj?.wallet?.shareBalance||0)}} </span>
    <span style="font-size:18px">{{UI.formatSharesToCurrency(null,UI.currentUserLastMessageObj?.wallet?.shareBalance||0)}} </span>
  </div>
  <span style="font-size:10px;margin-left:15px">{{UI.currentUserLastMessageObj?.userPresentation}} Level {{UI.currentUserLastMessageObj?.contract?.levelTimeAdjusted|number:'1.1-1'}}</span>
  <span *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="margin:15px;font-size:10px">Waiting for contract signature (Level {{UI.currentUserLastMessageObj?.contract?.level}})</span>
  <div class="seperator" style="width:100%;margin:0px"></div>
  </div>
  <div class='sheet'>
      <div style="font-size:14px;margin:20px">Your name (preferably your first name)</div>
      <input [(ngModel)]="name" placeholder="First name">
      <div class="buttonWhite" (click)="updateName()" style="font-size:12px;width:200px;padding:2px;margin:10px">Update my name</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px">Your preferred currency</div>
      <div style="padding:10px">
        <ul class="listLight">
          <li class="buttonBlack" *ngFor="let currency of objectToArray(UI.appSettingsPayment.currencyList)"
            (click)="UI.currentUserLastMessageObj?.userCurrency==currency[0]?'':updateUserCurrency(currency[0])"
            style="float:left;width:125px;padding:5px;margin:5px"
            [style.border-color]="UI.currentUserLastMessageObj?.userCurrency==currency[0]?'white':'black'"
            [style.pointer-events]="UI.currentUserLastMessageObj?.userCurrency==currency[0]?'none':'auto'">
            {{currency[1].designation}}
          </li>
        </ul>
      </div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px">Your short presentation</div>
      <div style="font-size:10px;margin:20px">Your short presentation helps other members get to know you.</div>
      <div style="font-size:10px;margin:10px 20px 0 20px">I am someone who is:</div>
      <input [(ngModel)]="userPresentation" placeholder="Your short presentation" maxlength="150">
      <div class="buttonWhite" (click)="updateUserPresentation()" style="font-size:12px;width:200px;padding:2px;margin:10px">Update my presentation</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px">Your public link</div>
      <div style="font-size:10px;margin:20px 20px 0 20px">Add view only public link so other members can view your documents, website, code and more.</div>
      <input [(ngModel)]="publicLink" placeholder="Add a link">
      <div class="buttonWhite" (click)="updatePublicLink()" style="font-size:12px;width:200px;padding:2px;margin:10px">Update my link</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px">Your email address</div>
      <div style="font-size:10px;margin:10px 20px 0 20px">Authentication address.</div>
      <input [(ngModel)]="emailsAuth" placeholder="Enter your authentication email">
      <div class="buttonWhite" (click)="updateEmails()" style="font-size:12px;width:250px;padding:2px;margin:10px">Update my email address</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
      <div style="font-size:14px;margin:20px">Your PERRINN contract</div>
      <div style="font-size:10px;margin:20px">This contract is between you and PERRINN team. When these settings are updated, they will need to be approved before taking effect. You or PERRINN can cancel this contract at any time.</div>
      <div style="font-size:10px;margin:15px 20px 0 20px">Level [1-10] defines the level of experience / capacity to resolve problems independently. Level 1 is university student with no experience, 10 is expert (10+ years experience in the field). After signature your level will increase automatically with time at a rate of +1 per year.</div>
      <input [(ngModel)]="contract.level" placeholder="Contract level">
      <div *ngIf="!UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px">No contract registered.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp" style="float:left;margin:15px;font-size:10px">Contract number {{UI.currentUserLastMessageObj?.contract?.createdTimestamp}}</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px">Signature valid for level {{UI.currentUserLastMessageObj?.contract?.signedLevel}}, you will receive {{UI.formatSharesToPRN(UI.currentUserLastMessageObj?.contract?.hourlyRate)}} or {{UI.formatSharesToCurrency(null,UI.currentUserLastMessageObj?.contract?.hourlyRate)}} per hour when you declare working hours.</div>
      <div *ngIf="UI.currentUserLastMessageObj?.contract?.createdTimestamp&&!UI.currentUserLastMessageObj?.contract?.signed" style="float:left;margin:15px;font-size:10px">Waiting for contract signature</div>
      <div class="buttonWhite" (click)="updateContract()" style="clear:both;font-size:12px;width:200px;padding:2px;margin:10px">Update my contract</div>
    <div class="seperator" style="width:100%;margin:0px"></div>
  <div class="buttonRed" style="width:100px;margin:25px auto" (click)="this.UI.logout()">logout</div>
  <div class="seperator" style="width:100%;margin-bottom:250px"></div>
  `,
})
export class SettingsComponent {
  name:string
  userPresentation:string
  emailsAuth:string
  contract:any
  searchFilter:string
  publicLink:any

  constructor(
    public afAuth:AngularFireAuth,
    public afs:AngularFirestore,
    public router:Router,
    private storage:AngularFireStorage,
    public UI:UserInterfaceService
  ) {
    this.contract={}
    this.name=this.UI.currentUserLastMessageObj.name||null
    this.userPresentation=this.UI.currentUserLastMessageObj.userPresentation||null
    this.publicLink=this.UI.currentUserLastMessageObj.publicLink||null
    this.emailsAuth=this.UI.currentUserLastMessageObj.emails.auth||null
    this.contract.level=(this.UI.currentUserLastMessageObj.contract||{}).level||null
  }

  ngOnInit() {
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

  updateUserCurrency(currency){
    if(!currency)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my preferred currency to '+this.UI.appSettingsPayment.currencyList[currency].designation,
      userCurrency:currency
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

  updatePublicLink(){
    if(this.publicLink==(this.UI.currentUserLastMessageObj.publicLink||null))return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my public link.',
      publicLink:this.publicLink
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  updateEmails(){
    if(this.emailsAuth!=this.UI.currentUserLastMessageObj.emails.auth){
      this.UI.createMessage({
        chain:this.UI.currentUser,
        text:'Updating my email addresses.',
        emails:{
          auth:this.emailsAuth
        }
      })
      this.router.navigate(['chat',this.UI.currentUser])
      return
    }
    else return
  }

  updateContract(){
    if(!this.contract.level)return
    this.UI.createMessage({
      chain:this.UI.currentUser,
      text:'Updating my contract details to level '+this.contract.level,
      contract:{
        level:this.contract.level
      }
    })
    this.router.navigate(['chat',this.UI.currentUser])
  }

  addChild(team){
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
