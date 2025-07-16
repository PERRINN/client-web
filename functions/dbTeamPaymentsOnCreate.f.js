const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
try {
  admin.initializeApp();
} catch (e) {}
const createMessageUtils = require("./utils/createMessage");

exports.dbTeamPaymentsOnCreate = onDocumentCreated(
  "PERRINNTeams/{user}/payments/{chargeID}",
  (event) => {
    return admin
      .auth()
      .getUser(event.params.user)
      .then(function (userRecord) {
        var email = userRecord.toJSON().email;
        const val = event.data;
        if (val === null || val.id || val.error) return null;
        const source = val.source;
        source.email = email;

        if (source.status === "succeeded") {
          let messageObj = {
            user: event.params.user,
            chain: event.params.user,
            userCurrency: val.currency,
            text: "Contributed " + val.amountCharge / 100 + val.currency,
            purchaseCOIN: {
              chargeID: event.params.chargeID,
              amount: val.amountSharesPurchased,
            },
          };
          createMessageUtils.createMessageAFS(messageObj);
        }
        return event.data.ref.set(source, { merge: true });
      });
  }
);
