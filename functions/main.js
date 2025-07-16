const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const admin = require('firebase-admin');
admin.initializeApp();
admin.firestore().settings({ ignoreUndefinedProperties: true });

// Import handlers
const verifyMessageUtils = require('./dbMessagesOnCreate.f.js');
const teamPayments = require('./dbTeamPaymentsOnCreate.f.js');
const teamReadsOnCreate = require('./dbTeamReadsOnCreate.f.js');
const teamReadsOnDelete = require('./dbTeamReadsOnDelete.f.js');
const storageFinalise = require('./storageOnFinalise.f.js');
const dailyMembership = require('./scheduledDailyMembership.f.js');

// Export functions
exports.dbMessagesOnCreate = verifyMessageUtils.dbMessagesOnCreate;
exports.dbTeamPaymentsOnCreate = teamPayments.dbTeamPaymentsOnCreate;
exports.dbTeamReadsOnCreate = teamReadsOnCreate.dbTeamReadsOnCreate;
exports.dbTeamReadsOnDelete = teamReadsOnDelete.dbTeamReadsOnDelete;
exports.storageOnFinalise = storageFinalise.storageOnFinalise;
exports.scheduledDailyMembership = dailyMembership.scheduledDailyMembership;
