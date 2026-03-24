const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const admin = require('firebase-admin');
admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

// Import handlers
const verifyMessageUtils = require('./dbMessagesOnCreate.f.js');
const teamPayments = require('./dbTeamPaymentsOnCreate.f.js');
const storageFinalise = require('./storageOnFinalise.f.js');
const dailyMembership = require('./scheduledDailyMembership.f.js');
const createRevolutOrder = require('./createRevolutOrder.f.js');
const revolutWebhook = require('./revolutWebhook.f.js');
const syncRevolutOrderStatus = require('./syncRevolutOrderStatus.f.js');
const driveFolderActivity = require('./driveFolderActivity.f.js');

// Export functions
exports.dbMessagesOnCreate = verifyMessageUtils.dbMessagesOnCreate;
exports.dbTeamPaymentsOnCreate = teamPayments.dbTeamPaymentsOnCreate;
exports.storageOnFinalise = storageFinalise.storageOnFinalise;
exports.scheduledDailyMembership = dailyMembership.scheduledDailyMembership;
exports.createRevolutOrder = createRevolutOrder.createRevolutOrder;
exports.revolutWebhook = revolutWebhook.revolutWebhook;
exports.syncRevolutOrderStatus = syncRevolutOrderStatus.syncRevolutOrderStatus;
exports.driveFolderActivity = driveFolderActivity.driveFolderActivity;
