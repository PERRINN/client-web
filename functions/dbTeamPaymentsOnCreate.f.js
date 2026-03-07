const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
try {
  admin.initializeApp();
} catch (e) {}
const createMessageUtils = require("./utils/createMessage");

function isSuccessfulStatus(status) {
  const value = String(status || "").toLowerCase();
  return ["succeeded", "completed", "paid", "captured", "authorised", "authorized"].includes(value);
}

exports.dbTeamPaymentsOnCreate = onDocumentWritten(
  "PERRINNTeams/{user}/payments/{chargeID}",
  async (event) => {
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;
    if (!after) return null;

    const previousStatus = (before?.source || before || {}).status || before?.status || null;
    const currentStatus = (after?.source || after || {}).status || after?.status || null;
    if (!isSuccessfulStatus(currentStatus)) return null;
    if (isSuccessfulStatus(previousStatus)) return null;
    if (after?.purchaseMessageCreated) return null;

    return admin
      .auth()
      .getUser(event.params.user)
      .then(async function (userRecord) {
        const email = userRecord.toJSON().email;
        const amountCharge = Number(after.amountCharge || 0);
        const amountSharesPurchased = Number(after.amountSharesPurchased || 0);
        const currency = String(after.currency || "usd").toLowerCase();

        if (!amountSharesPurchased || amountSharesPurchased <= 0) return null;

        const messageObj = {
          user: event.params.user,
          chain: event.params.user,
          userCurrency: currency,
          text: "Contributed " + amountCharge / 100 + currency,
          purchaseCOIN: {
            chargeID: event.params.chargeID,
            amount: amountSharesPurchased,
          },
        };

        await createMessageUtils.createMessageAFS(messageObj);

        return event.data.after.ref.set(
          {
            purchaseMessageCreated: true,
            processedTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            source: {
              ...((after.source || {}) || {}),
              email,
            },
          },
          { merge: true }
        );
      });
  }
);
