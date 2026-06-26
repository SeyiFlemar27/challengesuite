import { getChallengeDisplayStatus } from "@/lib/challenge-status";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireRequestUser, requireRole } from "@/lib/server/auth";
import { writeCashTransactionPlaceholder } from "@/lib/server/cash-transactions";
import { createNotification } from "@/lib/server/notifications";
import { writeDisabledPrizePoolFoundation } from "@/lib/server/prize-pools";
import { ok, readJson, serverUnavailable, validationError } from "@/lib/server/responses";

export async function GET() {
  const db = getAdminDb();
  if (!db) return serverUnavailable("Challenge listing");
  const snap = await db.collection("challenges").orderBy("createdAt", "desc").limit(100).get();
  const challenges = snap.docs.map((doc) => {
    const data = doc.data();
    return { ...data, id: doc.id, computedStatus: getChallengeDisplayStatus(data as any) };
  });
  return ok({ challenges }, "Challenges loaded.");
}

export async function POST(request: Request) {
  const { user, response } = await requireRequestUser(request);
  if (response) return response;
  const db = getAdminDb();
  if (!db) return serverUnavailable("Challenge creation");
  const permission = requireRole(user, ["creator", "sponsor"]);
  if (permission) return permission;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
  const fieldErrors: Record<string, string> = {};
  if (!body?.title) fieldErrors.title = "Title is required.";
  if (!body?.description) fieldErrors.description = "Description is required.";
  if (!body?.category) fieldErrors.category = "Category is required.";
  if (body?.acceptedSubmissionTypes && !Array.isArray(body.acceptedSubmissionTypes)) fieldErrors.acceptedSubmissionTypes = "Accepted submission types must be an array.";
  if (Object.keys(fieldErrors).length) return validationError(fieldErrors);

  const now = new Date().toISOString();
  const ref = db.collection("challenges").doc();
  const challenge = {
    id: ref.id,
    creatorId: user.uid,
    title: body.title,
    description: body.description,
    category: body.category,
    type: body.type ?? "public",
    status: body.publish ? "pending_review" : "draft",
    registrationDeadline: body.registrationDeadline,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    votingEndsAt: body.votingEndsAt,
    acceptedSubmissionTypes: body.acceptedSubmissionTypes ?? ["image"],
    rules: body.rules ?? [],
    prizeType: body.prizeType ?? "Bragging Rights (Leaderboard Ranking)",
    entryFee: 0,
    entryFeeCents: 0,
    paidEntryEnabled: false,
    prizePool: 0,
    prizePoolCents: 0,
    prizePoolEnabled: false,
    cashPayoutsEnabled: false,
    payoutStatus: "not_applicable",
    participantCount: 0,
    submissionCount: 0,
    voteCount: 0,
    weightedVoteCount: 0,
    requiresSubmissionApproval: true,
    createdAt: now,
    updatedAt: now
  };
  await Promise.all([
    ref.set(challenge),
    writeDisabledPrizePoolFoundation(db, ref.id, now),
    writeCashTransactionPlaceholder(db, {
      userId: user.uid,
      type: "prize_placeholder_created",
      status: "recorded",
      amountCents: 0,
      currency: "USD",
      sourceType: "challenge",
      sourceId: ref.id,
      challengeId: ref.id,
      description: `Prize foundation placeholder created for challenge ${ref.id}. No cash prize or payout movement is active.`,
      now
    })
  ]);
  await createNotification(db, { userId: user.uid, type: "challenge_created", title: "Challenge saved", body: `${challenge.title} was ${challenge.status}.`, targetId: ref.id });
  return ok({ challenge }, challenge.status === "pending_review" ? "Challenge submitted for review." : "Challenge draft saved.");
}
