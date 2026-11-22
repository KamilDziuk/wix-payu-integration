// @ts-nocheck
// Remembers, per Wix transaction, the PayU order ID and the Wix return URLs,
// so the buyer can be sent to the right page after returning from PayU.
// Requires a CMS collection "PayUTransactions" (permissions: Admin only).
import wixData from "wix-data";
import { logInfo, logError } from "backend/payU/payU-log";

const COLLECTION = "PayUTransactions";
const OPTIONS = { suppressAuth: true };

// The Wix transaction ID is used as the item _id.
export async function saveTransaction(wixTransactionId, record) {
  try {
    await wixData.save(COLLECTION, { _id: wixTransactionId, ...record }, OPTIONS);
    logInfo("Store", "transaction saved", {
      wixTransactionId,
      payuOrderId: record.payuOrderId,
    });
    return true;
  } catch (err) {
    logError("Store", "save failed - does the " + COLLECTION + " collection exist?", {
      wixTransactionId,
      error: err?.message || String(err),
    });
    return false;
  }
}

export async function getTransaction(wixTransactionId) {
  try {
    return await wixData.get(COLLECTION, wixTransactionId, OPTIONS);
  } catch (err) {
    logError("Store", "read failed", {
      wixTransactionId,
      error: err?.message || String(err),
    });
    return null;
  }
}
