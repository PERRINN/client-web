const functions = require("firebase-functions");
const admin = require("firebase-admin");
try {
  admin.initializeApp();
} catch (e) {}
const createMessageUtils = require("../../utils/createMessage");

exports = module.exports = functions.firestore
  .document("PERRINNTeams/{user}/payments/{chargeID}")
  .onCreate((data, context) => {
    return admin
      .auth()
      .getUser(context.params.user)
      .then(function (userRecord) {
        var email = userRecord.toJSON().email;
        const val = data.data();
        if (val === null || val.id || val.error) return null;
        const source = val.source;
        source.email = email;

        if (source.status === "succeeded") {
          let messageObj = {
            user: context.params.user,
            chain: context.params.user,
            userCurrency: val.currency,
            text: "Deposited " + val.amountCharge / 100 + val.currency,
            purchaseCOIN: {
              chargeID: context.params.chargeID,
              amount: val.amountSharesPurchased,
            },
          };
          createMessageUtils.createMessageAFS(messageObj);
        }
        return data.ref.set(source, { merge: true });
      });
  });
