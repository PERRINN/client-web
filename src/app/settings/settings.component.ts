import { Component } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router, ActivatedRoute } from '@angular/router';
import { UserInterfaceService } from './../userInterface.service';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

@Component({
  selector:'settings',
  templateUrl:'./settings.component.html',
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
