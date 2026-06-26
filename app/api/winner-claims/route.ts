import { getAdminDb } from "@/lib/firebase/admin";
import { requireRequestUser } from "@/lib/server/auth";
import { writeCashTransactionPlaceholder } from "@/lib/server/cash-transactions";
import { createPayoutPlaceholder } from "@/lib/server/payouts";
import { ok, serverUnavailable, validationError } from "@/lib/server/responses";

export async function POST(request: Request) {
  const { user, response } = await requireRequestUser(request);
  if (response) return response;
  const db = getAdminDb();
  if (!db) return serverUnavailable("Winner claims");

  const formData = await request.formData();
  const identityDocument = formData.get("identityDocument");
  if (!(identityDocument instanceof File)) {
    return validationError({ identityDocument: "Identity document upload is required for review. Document storage and KYC processing are not active yet." });
  }
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!submissionId) return validationError({ submissionId: "Submission ID is required." });

  const submissionSnap = await db.collection("submissions").doc(submissionId).get();
  if (!submissionSnap.exists) return validationError({ submissionId: "Submission does not exist." });
  const submission = submissionSnap.data() ?? {};
  if (submission.userId && submission.userId !== user.uid) return validationError({ submissionId: "You can only submit a claim for your own winning submission." });

  const now = new Date().toISOString();
  const ref = db.collection("winnerClaims").doc();
  const payoutRef = db.collection("payouts").doc();
  const challengeId = typeof submission.challengeId === "string" ? submission.challengeId : null;
  const payout = createPayoutPlaceholder({ id: payoutRef.id, userId: user.uid, challengeId, submissionId, winnerClaimId: ref.id, sourceId: ref.id, now });
  const claim = {
    id: ref.id,
    userId: user.uid,
    submissionId,
    challengeId: submission.challengeId ?? null,
    status: "pending_review",
    reviewStatus: "pending_review",
    payoutId: payoutRef.id,
    payoutStatus: "pending_review",
    payoutProviderConnected: false,
    transferEnabled: false,
    identityDocumentName: identityDocument.name,
    identityDocumentStorageStatus: "not_processed",
    kycProcessingStatus: "not_active",
    createdAt: now,
    updatedAt: now
  };
  await Promise.all([
    ref.set(claim),
    payoutRef.set(payout),
    writeCashTransactionPlaceholder(db, {
      userId: user.uid,
      type: "payout_review_created",
      status: "pending_review",
      amountCents: payout.amountCents,
      currency: payout.currency,
      sourceType: "winner_claim",
      sourceId: ref.id,
      challengeId,
      submissionId,
      winnerClaimId: ref.id,
      payoutId: payoutRef.id,
      description: `Payout review placeholder created for winner claim ${ref.id}. This does not approve or send payment.`,
      now
    })
  ]);
  return ok({ claim, payout }, "Winner claim submitted for review. Payout processing is not active yet.");
}
