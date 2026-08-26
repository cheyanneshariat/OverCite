export const ACKNOWLEDGMENT_REMINDER_VERSION = 1;
export const ACKNOWLEDGMENT_REMINDER_STORAGE_KEY = "acknowledgmentReminderVersion";
export const ACKNOWLEDGMENT_REMINDER_PROMPT =
  "Citation inserted. If OverCite helped with this manuscript, please consider acknowledging it.";
export const ACKNOWLEDGMENT_TEXT =
  "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX.";

export function createAcknowledgmentReminderClaim(storage) {
  let handledThisSession = false;

  return async function claimAcknowledgmentReminder() {
    if (handledThisSession || !storage) {
      return false;
    }
    handledThisSession = true;

    try {
      const stored = await storage.get(ACKNOWLEDGMENT_REMINDER_STORAGE_KEY);
      const recordedVersion = Number(stored?.[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY] ?? 0);
      if (recordedVersion >= ACKNOWLEDGMENT_REMINDER_VERSION) {
        return false;
      }
      await storage.set({
        [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: ACKNOWLEDGMENT_REMINDER_VERSION
      });
      return true;
    } catch (error) {
      console.warn("[OverCite] Could not persist the one-time acknowledgment reminder state.", error);
      return false;
    }
  };
}
