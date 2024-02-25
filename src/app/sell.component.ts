import {
  AfterViewInit,
  ChangeDetectorRef,
  ElementRef,
  Inject,
  OnDestroy,
  ViewChild,
} from "@angular/core";
import { Component, NgZone } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Router } from "@angular/router";
import { UserInterfaceService } from "./userInterface.service";
import {
  AngularFirestore,
  AngularFirestoreCollection,
} from "@angular/fire/compat/firestore";
import { AngularFireAuth } from "@angular/fire/compat/auth";
import firebase from "firebase/compat/app";
import { environment } from "environments/environment.prod";

@Component({
  selector: "sell",
  template: `
    <div class="sheet">
      <div style="font-size:14px;line-height:20px;padding:30px">Soon you will be able to sell your credit to other members from here.</div>
      <div style="font-size:14px;line-height:20px;padding:30px">We are building this new feature, stay tuned.</div>
      <div class="seperator" style="width:100%;margin:0px"></div>
    </div>
  `,
})
export class SellComponent {

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private http: HttpClient
  ) {
  }

  ngOnInit() {
    this.UI.redirectUser()
  }

}
