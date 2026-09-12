export const ACKNOWLEDGMENT_REMINDER_VERSION = 2;
export const ACKNOWLEDGMENT_REMINDER_STORAGE_KEY = "acknowledgmentReminderVersion";
export const ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY = "acknowledgmentReminderNextEligibleAt";
export const ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY = "acknowledgmentReminderDisabled";
export const ACKNOWLEDGMENT_REMINDER_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
export const ACKNOWLEDGMENT_REMINDER_PROMPT =
  "Publishing work that used OverCite? Please consider acknowledging it!";
export const ACKNOWLEDGMENT_TEXT =
  "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX.";
export const COPY_ACKNOWLEDGMENT_ACTION = "Copy acknowledgment";
export const REMIND_LATER_ACTION = "Remind me later";
export const NEVER_REMIND_ACTION = "Never remind me again";

export function createCompletionNotifier({ globalState, showInformationMessage, writeClipboard, now = () => Date.now() }) {
  let handledThisSession = false;

  return async function notifyCompletion(successMessage) {
    let shouldShowReminder = false;
    if (!handledThisSession) {
      handledThisSession = true;
      try {
        const disabled = globalState.get(ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY, false) === true;
        const currentTime = now();
        const nextEligibleAt = Number(globalState.get(ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY, 0));
        if (!disabled && (!Number.isFinite(nextEligibleAt) || nextEligibleAt <= currentTime)) {
          await globalState.update(
            ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
            currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
          );
          await globalState.update(
            ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
            ACKNOWLEDGMENT_REMINDER_VERSION
          );
          shouldShowReminder = true;
        }
      } catch (error) {
        console.warn("[OverCite] Could not persist the acknowledgment reminder state.", error);
      }
    }

    if (!shouldShowReminder) {
      await showInformationMessage(successMessage);
      return false;
    }

    const selected = await showInformationMessage(
      ACKNOWLEDGMENT_REMINDER_PROMPT,
      COPY_ACKNOWLEDGMENT_ACTION,
      REMIND_LATER_ACTION,
      NEVER_REMIND_ACTION
    );
    if (selected === COPY_ACKNOWLEDGMENT_ACTION) {
      try {
        await writeClipboard(ACKNOWLEDGMENT_TEXT);
        await showInformationMessage("Acknowledgment copied.");
      } catch (error) {
        console.warn("[OverCite] Could not copy the acknowledgment text.", error);
      }
    } else if (selected === NEVER_REMIND_ACTION) {
      try {
        await globalState.update(ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY, true);
      } catch (error) {
        console.warn("[OverCite] Could not disable acknowledgment reminders.", error);
      }
    }
    return true;
  };
}
