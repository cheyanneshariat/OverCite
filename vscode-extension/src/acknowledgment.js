export const ACKNOWLEDGMENT_REMINDER_VERSION = 1;
export const ACKNOWLEDGMENT_REMINDER_STORAGE_KEY = "acknowledgmentReminderVersion";
export const ACKNOWLEDGMENT_REMINDER_PROMPT =
  "If OverCite helped with this manuscript, please consider acknowledging it.";
export const ACKNOWLEDGMENT_TEXT =
  "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX.";
export const COPY_ACKNOWLEDGMENT_ACTION = "Copy acknowledgment";

export function createCompletionNotifier({ globalState, showInformationMessage, writeClipboard }) {
  let handledThisSession = false;

  return async function notifyCompletion(successMessage) {
    let shouldShowReminder = false;
    if (!handledThisSession) {
      handledThisSession = true;
      try {
        const recordedVersion = Number(
          globalState.get(ACKNOWLEDGMENT_REMINDER_STORAGE_KEY, 0)
        );
        if (recordedVersion < ACKNOWLEDGMENT_REMINDER_VERSION) {
          await globalState.update(
            ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
            ACKNOWLEDGMENT_REMINDER_VERSION
          );
          shouldShowReminder = true;
        }
      } catch (error) {
        console.warn("[OverCite] Could not persist the one-time acknowledgment reminder state.", error);
      }
    }

    if (!shouldShowReminder) {
      await showInformationMessage(successMessage);
      return false;
    }

    const selected = await showInformationMessage(
      `${successMessage} ${ACKNOWLEDGMENT_REMINDER_PROMPT}`,
      COPY_ACKNOWLEDGMENT_ACTION
    );
    if (selected === COPY_ACKNOWLEDGMENT_ACTION) {
      try {
        await writeClipboard(ACKNOWLEDGMENT_TEXT);
        await showInformationMessage("Acknowledgment copied.");
      } catch (error) {
        console.warn("[OverCite] Could not copy the acknowledgment text.", error);
      }
    }
    return true;
  };
}
