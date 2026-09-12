export const ACKNOWLEDGMENT_REMINDER_VERSION = 2;
export const ACKNOWLEDGMENT_REMINDER_STORAGE_KEY = "acknowledgmentReminderVersion";
export const ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY = "acknowledgmentReminderNextEligibleAt";
export const ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY = "acknowledgmentReminderDisabled";
export const ACKNOWLEDGMENT_REMINDER_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
export const ACKNOWLEDGMENT_REMINDER_PROMPT =
  "Publishing work that used OverCite? Please consider acknowledging it!";
export const ACKNOWLEDGMENT_TEXT =
  "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX.";

export function createAcknowledgmentReminderClaim(storage, { now = () => Date.now() } = {}) {
  let handledThisSession = false;

  return async function claimAcknowledgmentReminder() {
    if (handledThisSession || !storage) {
      return false;
    }
    handledThisSession = true;

    try {
      const stored = await storage.get([
        ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
        ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY
      ]);
      if (stored?.[ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY] === true) {
        return false;
      }
      const currentTime = now();
      const nextEligibleAt = Number(stored?.[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY] ?? 0);
      if (Number.isFinite(nextEligibleAt) && nextEligibleAt > currentTime) {
        return false;
      }
      await storage.set({
        [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: ACKNOWLEDGMENT_REMINDER_VERSION,
        [ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY]: currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
      });
      return true;
    } catch (error) {
      console.warn("[OverCite] Could not persist the acknowledgment reminder state.", error);
      return false;
    }
  };
}

export async function disableAcknowledgmentReminder(storage) {
  if (!storage) {
    return false;
  }
  try {
    await storage.set({ [ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY]: true });
    return true;
  } catch (error) {
    console.warn("[OverCite] Could not disable acknowledgment reminders.", error);
    return false;
  }
}
