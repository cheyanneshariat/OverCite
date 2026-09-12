// Both promises have rejection handlers from creation, including when discovery
// fails before the caller opens the picker.
export function startCandidateSearch(search) {
  let publish;
  const published = new Promise((resolve) => { publish = resolve; });
  const final = Promise.resolve().then(() => search(publish));
  const ready = Promise.race([published, final]);
  void ready.catch(() => {});
  return { ready, final };
}

export function showCandidatePicker(window, items, finalItems, placeHolder) {
  const picker = window.createQuickPick();
  picker.items = items;
  picker.placeholder = placeHolder;
  // A settled metadata promise may run before QuickPick's first render.
  // Establish the initial active item explicitly so enrichment cannot clear
  // the default focus before the user presses Enter.
  picker.activeItems = items.length ? [items[0]] : [];
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;
  return new Promise((resolve) => {
    let closed = false;
    const subscriptions = [];
    function finish(item) {
      if (closed) return;
      closed = true;
      for (const subscription of subscriptions) subscription.dispose();
      picker.dispose();
      resolve(item);
    }
    subscriptions.push(picker.onDidAccept(() => finish(picker.selectedItems[0] ?? picker.activeItems[0])));
    subscriptions.push(picker.onDidHide(() => finish(undefined)));
    void finalItems.then((updated) => {
      if (closed || updated.length !== items.length) return;
      // This is metadata enrichment, not a rerank. Refuse unexpected identity
      // changes and preserve the same items, query, selection and active item.
      if (updated.some((item, index) => item.label !== items[index].label || item.detail !== items[index].detail)) return;
      const active = picker.activeItems;
      const selected = picker.selectedItems;
      for (let index = 0; index < items.length; index += 1) items[index].description = updated[index].description;
      picker.items = items;
      picker.activeItems = active;
      picker.selectedItems = selected;
    }).catch(() => {});
    picker.show();
  });
}
