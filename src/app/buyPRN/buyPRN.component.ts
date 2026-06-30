import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, Subject, interval } from "rxjs";
import { map, takeUntil } from "rxjs/operators";
import { Router, ActivatedRoute } from "@angular/router";
import { UserInterfaceService } from "../userInterface.service";
import { AngularFirestore } from "@angular/fire/compat/firestore";
import { AngularFireAuth } from "@angular/fire/compat/auth";
import { environment } from "../../environments/environment";
import { AgChartOptions } from "ag-charts-community";
import { firstValueFrom } from "rxjs";

interface RevolutOrderResponse {
  checkout_url?: string;
  id?: string;
}

type PaymentState =
  | "idle"
  | "creating-order"
  | "checkout-opened"
  | "awaiting-payment"
  | "payment-received"
  | "crediting"
  | "completed"
  | "failed";


@Component({
  selector: "buyPRN",
  templateUrl: 'buyPRN.component.html'
})
export class buyPRNComponent implements OnInit, OnDestroy {
  transactionPendingMessage: string | null = null;
  transactionPendingMessageObj: any = null;
  amountSharesPurchased = 0;
  amountCharge = 0;
  currencySelected = 'usd';
  creditListPRN: number[] = [];
  creditList: number[] = [];
  creditSelected = 0;
  processing = false;
  showPastFunds = false;
  currentFunds!: Observable<any[]>;
  chartOptions!: AgChartOptions;
  paymentState: PaymentState = "idle";
  paymentStatusText = "";
  paymentOrderId: string | null = null;
  paymentReference: string | null = null;
  paymentStepOrderCreated = false;
  paymentStepCheckoutOpened = false;
  paymentStepPaymentReceived = false;
  paymentStepMessageGenerated = false;
  paymentStepCredited = false;
  showPrnInfoPopup = false;
  private paymentTrackingVersion = 0;
  private paymentSyncInFlight = false;
  private hasUserManuallySelectedCurrency = false;
  private lastCreditsBase = 0;
  private lastSyncedCurrency = "";
  private previousMainContainerOverflow = "";
  private previousBodyOverflow = "";

  private destroy$ = new Subject<void>();

  constructor(
    public afAuth: AngularFireAuth,
    public afs: AngularFirestore,
    public router: Router,
    private _zone: NgZone,
    public UI: UserInterfaceService,
    private cd: ChangeDetectorRef,
    private route: ActivatedRoute,
    private http: HttpClient
  ) {
    this.currencySelected =
      UI.currentUserLastMessageObj?.userCurrency || "usd";
  }

  ngOnInit(): void {
    this.setupTransactionListener();
    this.setupCurrentFunds();
    this.chartOptions = this.buildChartOptions();
    this.syncCurrencyAndCredits();
    interval(600)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.syncCurrencyAndCredits());
    this.restorePendingPaymentFromLocalCache();
  }

  ngOnDestroy(): void {
    this.unlockBackgroundScroll();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private lockBackgroundScroll(): void {
    const mainContainer = document.getElementById("main_container");
    if (mainContainer) {
      this.previousMainContainerOverflow = mainContainer.style.overflowY || "";
      mainContainer.style.overflowY = "hidden";
    }
    this.previousBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  }

  private unlockBackgroundScroll(): void {
    const mainContainer = document.getElementById("main_container");
    if (mainContainer) {
      mainContainer.style.overflowY = this.previousMainContainerOverflow || "";
    }
    document.body.style.overflow = this.previousBodyOverflow || "";
  }

  openPrnInfoPopup(): void {
    this.showPrnInfoPopup = true;
    this.lockBackgroundScroll();
  }

  closePrnInfoPopup(): void {
    this.showPrnInfoPopup = false;
    this.unlockBackgroundScroll();
  }

  get isPaymentFlowLocked(): boolean {
    return (
      this.paymentState === "creating-order" ||
      this.paymentState === "checkout-opened" ||
      this.paymentState === "awaiting-payment" ||
      this.paymentState === "payment-received" ||
      this.paymentState === "crediting"
    );
  }

  private setPaymentState(state: PaymentState, text: string): void {
    this.paymentState = state;
    this.paymentStatusText = text;
  }

  private storePendingPaymentLocalCache(): void {
    if (!this.paymentOrderId || !this.paymentReference) return;
    localStorage.setItem(
      "buyPRN_pendingPayment",
      JSON.stringify({
        orderId: this.paymentOrderId,
        reference: this.paymentReference,
        timestamp: Date.now(),
      })
    );
  }

  private restorePendingPaymentFromLocalCache(): void {
    const raw = localStorage.getItem("buyPRN_pendingPayment");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.orderId || !parsed?.reference) return;
      this.paymentOrderId = parsed.orderId;
      this.paymentReference = parsed.reference;
      this.paymentStepOrderCreated = true;
      this.paymentStepCheckoutOpened = true;
      this.setPaymentState("awaiting-payment", "Waiting for Revolut payment confirmation...");
      this.startPaymentTracking();
    } catch (e) {
      localStorage.removeItem("buyPRN_pendingPayment");
    }
  }

  private clearPendingPaymentLocalCache(): void {
    localStorage.removeItem("buyPRN_pendingPayment");
  }

  private isPaymentSuccessStatus(status: any): boolean {
    const value = String(status || "").toLowerCase();
    return ["succeeded", "completed", "paid", "captured", "authorised", "authorized"].includes(value);
  }

  private isPaymentFailureStatus(status: any): boolean {
    const value = String(status || "").toLowerCase();
    return ["failed", "cancelled", "canceled", "declined"].includes(value);
  }

  private async syncPaymentStatusFromRevolut(): Promise<void> {
    if (this.paymentSyncInFlight) return;
    if (!this.UI.currentUser || !this.paymentOrderId) return;
    if (!(this.paymentState === "awaiting-payment" || this.paymentState === "payment-received" || this.paymentState === "crediting")) return;

    this.paymentSyncInFlight = true;
    try {
      await firstValueFrom(
        this.http.post<any>(
          "https://us-central1-perrinn-d5fc1.cloudfunctions.net/syncRevolutOrderStatus",
          {
            orderId: this.paymentOrderId,
            mode: this.UI.revolutMode === "prod" ? "prod" : "sandbox",
            user: this.UI.currentUser,
            reference: this.paymentReference,
          }
        )
      );
    } catch (err) {
      console.warn("syncPaymentStatusFromRevolut failed", err);
    } finally {
      this.paymentSyncInFlight = false;
    }
  }

  resetPaymentFlow(): void {
    this.paymentTrackingVersion++;
    this.processing = false;
    this.paymentOrderId = null;
    this.paymentReference = null;
    this.paymentStepOrderCreated = false;
    this.paymentStepCheckoutOpened = false;
    this.paymentStepPaymentReceived = false;
    this.paymentStepMessageGenerated = false;
    this.paymentStepCredited = false;
    this.setPaymentState("idle", "");
    this.clearPendingPaymentLocalCache();
  }

  private startPaymentTracking(): void {
    if (!this.UI.currentUser || !this.paymentOrderId) return;
    const version = ++this.paymentTrackingVersion;

    this.afs
      .doc<any>(`PERRINNTeams/${this.UI.currentUser}/payments/${this.paymentOrderId}`)
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((paymentDoc) => {
        if (version !== this.paymentTrackingVersion || !paymentDoc) return;
        const status = (paymentDoc.source || paymentDoc).status || paymentDoc.status;

        if (this.isPaymentSuccessStatus(status)) {
          this.paymentStepPaymentReceived = true;
          this.setPaymentState("payment-received", "Payment received by Revolut. Finalizing credit...");
        }

        if (this.isPaymentFailureStatus(status)) {
          this.setPaymentState("failed", "Payment failed or was cancelled. You can try again.");
          this.clearPendingPaymentLocalCache();
          this.paymentTrackingVersion++;
        }
      });

    interval(7000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (version !== this.paymentTrackingVersion) return;
        this.syncPaymentStatusFromRevolut();
      });

    this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("user", "==", this.UI.currentUser)
          .where("verified", "==", true)
          .orderBy("serverTimestamp", "desc")
          .limit(40)
      )
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((messages) => {
        if (version !== this.paymentTrackingVersion || !Array.isArray(messages)) return;
        const matchingCredit = messages.find(
          (message) => ((message.purchaseCOIN || {}).chargeID || null) === this.paymentOrderId
        );
        if (!matchingCredit) return;

        this.paymentStepMessageGenerated = true;
        this.setPaymentState("crediting", "PERRINN message generated. Crediting PRN wallet...");

        setTimeout(() => {
          if (version !== this.paymentTrackingVersion) return;
          this.paymentStepCredited = true;
          this.setPaymentState("completed", "Payment successful. PRN tokens are now credited.");
          this.clearPendingPaymentLocalCache();
          this.paymentTrackingVersion++;
        }, 300);
      });
  }

  private setupTransactionListener(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.transactionPendingMessage = params.id;
      this.afs
        .doc<any>(`PERRINNMessages/${params.id}`)
        .valueChanges()
        .pipe(takeUntil(this.destroy$))
        .subscribe(
          (document) => {
            this.transactionPendingMessageObj = document || null;
            if (!document) console.log("No document found with the given ID.");
          },
          (error) => console.error("Error retrieving document:", error)
        );
    });
  }

  private setupCurrentFunds(): void {
    this.currentFunds = this.afs
      .collection<any>("PERRINNMessages", (ref) =>
        ref
          .where("lastMessage", "==", true)
          .where("verified", "==", true)
          .orderBy("fund.daysLeft", "desc")
      )
      .snapshotChanges()
      .pipe(
        map((changes) => changes
          .map((c) => ({ payload: c.payload }))
          .filter((m) => (m.payload.doc.data()?.fund?.amountGBPTarget || 0) >= 0.01)
        ),
        takeUntil(this.destroy$)
      );
  }

  private buildChartOptions(): AgChartOptions {
    const now = this.UI.nowSeconds * 1000;
    const start = 1296578670000;
    const yearMs = 365 * 24 * 3600000;
    const scale = 0.1 / (365 * 24 * 3600);

    const calcPrice = (time: number) =>
      Math.exp(((time - start) / 1000) * scale);

    return {
      title: { text: "PRN growth" },
      data: [
        { year: start, price: 1 },
        { year: now - 6 * yearMs, price: calcPrice(now - 6 * yearMs) },
        { year: now, price: calcPrice(now) },
        { year: now + 6 * yearMs, price: calcPrice(now + 6 * yearMs) },
      ],
      series: [{ type: "line", xKey: "year", yKey: "price" }],
      theme: "ag-default-dark",
      axes: [
        { type: "time", position: "bottom" },
        { type: "number", position: "left", keys: ["price"] },
      ],
    };
  }

  private buildCreditList(base?: number): number[] {
    const amountRequired = Number((base ?? this.UI.PERRINNAdminLastMessageObj?.membership?.amountRequired) || 0);
    if (!amountRequired || amountRequired <= 0) return [];
    const amounts = [amountRequired, amountRequired * 2, amountRequired * 4, amountRequired * 10, amountRequired * 20];
    return this.UI.isDev ? [1, ...amounts] : amounts;
  }

  private syncCurrencyAndCredits(): void {
    const currencyList = this.UI.PERRINNAdminLastMessageObj?.currencyList || {};
    const preferredCurrency = this.UI.currentUserLastMessageObj?.userCurrency;

    if (
      !this.hasUserManuallySelectedCurrency &&
      preferredCurrency &&
      currencyList[preferredCurrency] &&
      this.currencySelected !== preferredCurrency
    ) {
      this.currencySelected = preferredCurrency;
    }

    if (!this.currencySelected || !currencyList[this.currencySelected]) {
      const fallbackCurrency = preferredCurrency && currencyList[preferredCurrency]
        ? preferredCurrency
        : (currencyList["usd"] ? "usd" : Object.keys(currencyList)[0]);
      if (fallbackCurrency) this.currencySelected = fallbackCurrency;
    }

    const creditsBase = Number(this.UI.PERRINNAdminLastMessageObj?.membership?.amountRequired || 0);
    if (!creditsBase || creditsBase <= 0) return;

    if (this.lastCreditsBase !== creditsBase || !this.creditListPRN?.length) {
      this.lastCreditsBase = creditsBase;
      this.creditListPRN = this.buildCreditList(creditsBase);
    }

    if (!this.creditListPRN?.length || !this.currencySelected) return;

    if (this.lastSyncedCurrency !== this.currencySelected || !this.creditList?.length) {
      this.refreshCreditList();
      this.lastSyncedCurrency = this.currencySelected;
    }

    if (this.creditSelected == null || this.creditSelected >= this.creditList.length) {
      this.creditSelected = 0;
    }

    this.refreshAmountCharge();
  }

  onCurrencySelected(currency: string): void {
    if (!currency) return;
    this.hasUserManuallySelectedCurrency = true;
    this.currencySelected = currency;
    this.refreshCreditList();
    if (this.creditSelected == null) this.creditSelected = 0;
    this.refreshAmountCharge();
  }

  refreshCreditList(): void {
    if (!this.creditListPRN?.length || !this.currencySelected) {
      this.creditList = [];
      return;
    }
    this.creditList = this.creditListPRN.map((creditPRN) =>
      this.UI.roundUpByMagnitude(
        this.UI.convertPRNToCurrency(this.currencySelected, creditPRN)
      )
    );
  }

  refreshAmountCharge(): void {
    if (this.creditSelected == null || this.currencySelected == null) return;
    const selectedCurrency = this.UI.PERRINNAdminLastMessageObj?.currencyList?.[this.currencySelected];
    if (!selectedCurrency || !this.creditList?.length) return;

    this.amountCharge = Number(
      ((this.creditList[this.creditSelected] || 0) * 100).toFixed(0)
    );
    this.amountSharesPurchased = Number(
      (this.amountCharge / 100) *
        selectedCurrency.toCOIN
    );
  }

  objectToArray(obj: any): [string, any][] {
    return obj ? Object.entries(obj) : [];
  }

  activateTransactionPending(transactionPendingMessage: string | null): void {
    if (!transactionPendingMessage) {
      console.error("No transaction message provided");
      return;
    }
    this.UI.createMessage({
      chain: this.UI.currentUser,
      text: `Activating transaction ${transactionPendingMessage}`,
      transactionPending: {
        activateTransactionPending: transactionPendingMessage,
      },
    });
    this.router.navigate(["chat", this.UI.currentUser]);
  }

  async payWithRevolutLink(): Promise<void> {
    if (this.isPaymentFlowLocked) return;

    const newWindow = window.open("", "_blank");
    this.processing = true;
    this.paymentTrackingVersion++;
    this.paymentOrderId = null;
    this.paymentReference = `PRN-${this.UI.currentUser || "anon"}-${Date.now()}`;
    this.paymentStepOrderCreated = false;
    this.paymentStepCheckoutOpened = false;
    this.paymentStepPaymentReceived = false;
    this.paymentStepMessageGenerated = false;
    this.paymentStepCredited = false;
    this.setPaymentState("creating-order", "Creating Revolut order...");

    try {
      const body = {
        amount: this.amountCharge,
        currency: (this.currencySelected || "usd").toUpperCase(),
        email: this.UI.currentUserEmail,
        reference: this.paymentReference,
        description: `Credit ${this.UI.formatPRNCurrency(
          this.currencySelected,
          this.creditList[this.creditSelected]
        )} to ${this.UI.currentUserEmail}`,
        mode: this.UI.revolutMode === "prod" ? "prod" : "sandbox",
        user: this.UI.currentUser,
        amountCharge: this.amountCharge,
        amountSharesPurchased: this.amountSharesPurchased,
      };

      const order = await firstValueFrom(
        this.http.post<RevolutOrderResponse>(
          "https://us-central1-perrinn-d5fc1.cloudfunctions.net/createRevolutOrder",
          body
        )
      );

      if (order?.checkout_url) {
        this.paymentOrderId = order.id || null;
        this.paymentStepOrderCreated = true;
        this.setPaymentState("checkout-opened", "Opening Revolut checkout...");

        if (this.paymentOrderId) {
          this.storePendingPaymentLocalCache();
          this.startPaymentTracking();
        }

        if (newWindow) {
          newWindow.location.href = order.checkout_url;
          this.paymentStepCheckoutOpened = true;
          this.setPaymentState("awaiting-payment", "Checkout opened. Complete payment in Revolut, then return here.");
        } else {
          this.setPaymentState("failed", "Could not open Revolut checkout. Please allow popups and try again.");
        }
      } else {
        newWindow?.close();
        this.setPaymentState("failed", "Could not open Revolut checkout. Please try again.");
      }
    } catch (err) {
      console.error(err);
      newWindow?.close();
      this.setPaymentState("failed", "Payment request failed. Please try again.");
    } finally {
      this.processing = false;
    }
  }
}
