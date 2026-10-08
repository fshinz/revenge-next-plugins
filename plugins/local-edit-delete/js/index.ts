let activeMessage: any = null;
let editIconGetter: () => any = () => null;
let deleteIconGetter: () => any = () => null;

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

function hideSheet() {
  try {
    (revenge as any).discord?.actions?.ActionSheetActionCreators?.hideActionSheet?.();
  } catch {}
}

function showToast(content: string) {
  try {
    (revenge as any).discord?.actions?.ToastActionCreators?.showToast?.({ content });
  } catch {}
}

function isRowArray(arr: any[]): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const first = arr[0];
  return (
    first?.type?.name === "ActionSheetRow" ||
    (first?.props && typeof first.props.label === "string")
  );
}

function walkRows(tree: any, out: any[] = []): any[] {
  if (!tree || typeof tree !== "object") return out;
  if (Array.isArray(tree)) {
    if (isRowArray(tree) && !out.includes(tree)) out.push(tree);
    tree.forEach((c: any) => walkRows(c, out));
    return out;
  }
  const k = tree?.props?.children;
  if (Array.isArray(k)) {
    if (isRowArray(k) && !out.includes(k)) out.push(k);
    k.forEach((c: any) => walkRows(c, out));
  } else {
    walkRows(k, out);
  }
  return out;
}

function makeIconGetter(name: string): () => any {
  const wg = (revenge as any).utils?.discord?.withGeneratedIconComponent;
  const filter = wg ? wg(name) : (revenge as any).modules?.finders?.filters?.withProps(name);
  let cached: any = null;
  let unsub: (() => void) | undefined;
  try {
    unsub = (revenge as any).modules?.finders?.getModules(
      filter,
      (exports: any) => {
        const val = exports?.[name] ?? exports?.default ?? exports;
        if (val) {
          cached = val;
          unsub?.();
        }
      },
      { returnNamespace: true }
    );
  } catch {}
  return () => cached;
}

function makeRow(tpl: any, label: string, icon: any, onPress: () => void): any {
  const { React } = (revenge as any).react;
  const Row = tpl?.type;
  if (!Row) return null;
  const Icon = Row?.Icon;
  const iconEl = Icon && icon ? React.createElement(Icon, { IconComponent: icon }) : null;
  return React.createElement(Row, { key: label, label, icon: iconEl, onPress });
}

function dispatchLocalEdit(message: any, newContent: string) {
  if (!message || !message.id || !message.channel_id) return;

  let content = newContent;
  // Zero-width space toggle trick to force React state diffing
  if (content.endsWith("\u200b")) {
    content = content.replace(/\u200b/g, "");
  } else {
    content += "\u200b";
  }

  localEdits.set(message.id, content);

  const updatedMsg = {
    ...message,
    content: content,
    edited_timestamp: new Date().toISOString(),
  };

  (revenge as any).discord?.stores?.Dispatcher?.dispatch({
    type: "MESSAGE_UPDATE",
    message: updatedMsg,
  });

  showToast("Locally edited!");
}

function triggerLocalEdit(message: any) {
  const currentText = localEdits.get(message.id) ?? message.content ?? "";
  
  // Safe alert modal caller
  const Alerts = (revenge as any).discord?.actions?.Alerts;
  if (Alerts?.show) {
    try {
      Alerts.show({
        title: "Local Edit Message",
        body: "Enter new content for this message:",
        inputs: [
          {
            name: "content",
            placeholder: "Edit message content...",
            value: currentText,
          },
        ],
        confirmText: "Save",
        cancelText: "Cancel",
        onConfirm: (data: any) => {
          const val = typeof data === "string" ? data : data?.content || currentText;
          dispatchLocalEdit(message, val);
        },
      });
      return;
    } catch {}
  }

  // Fallback if Alerts interface is structured differently
  const newText = prompt("Local Edit Message Content:", currentText);
  if (newText !== null) {
    dispatchLocalEdit(message, newText);
  }
}

function triggerLocalDelete(message: any) {
  if (!message || !message.id || !message.channel_id) return;

  localDeletes.add(message.id);

  (revenge as any).discord?.stores?.Dispatcher?.dispatch({
    type: "MESSAGE_DELETE",
    id: message.id,
    channel_id: message.channel_id,
  });

  showToast("Locally deleted!");
}

function inject(res: any): any {
  if (!res || !activeMessage?.id) return res;

  const groups = walkRows(res);
  if (groups.length === 0) return res;

  // Select the LAST section (beside normal delete/report) instead of top
  const lastGroup = groups[groups.length - 1];
  const tpl = lastGroup?.find?.((r: any) => r?.props?.label != null) ?? lastGroup?.[0];
  if (!tpl) return res;

  const editRow = makeRow(tpl, "Local Edit Message", editIconGetter(), () => {
    const targetMsg = activeMessage;
    hideSheet();
    setTimeout(() => {
      triggerLocalEdit(targetMsg);
    }, 100);
  });

  const deleteRow = makeRow(tpl, "Local Delete Message", deleteIconGetter(), () => {
    const targetMsg = activeMessage;
    hideSheet();
    setTimeout(() => {
      triggerLocalDelete(targetMsg);
    }, 100);
  });

  // Append to bottom section
  if (editRow) lastGroup.push(editRow);
  if (deleteRow) lastGroup.push(deleteRow);

  return res;
}

function installWrapper(ns: any) {
  const mod = ns?.default ?? ns;
  if (typeof mod !== "function") return () => {};
  const orig = mod;
  const wrapped = (props: any) => {
    const res = orig(props);
    try {
      return activeMessage ? inject(res) : res;
    } catch {
      return res;
    }
  };
  ns.default = wrapped;
  return () => {
    if (ns.default === wrapped) ns.default = orig;
  };
}

function onImportedPath(path: string, cb: (ns: any) => void): () => void {
  try {
    return (
      (revenge as any).discord?.utils?.modules?.finders?.getModuleWithImportedPath(
        path,
        (ns: any) => cb(ns)
      ) ?? (() => {})
    );
  } catch {
    return () => {};
  }
}

export default {
  start({ cleanup }: { cleanup: (fn: () => void) => void }) {
    editIconGetter = makeIconGetter("PencilSparkleIcon");
    deleteIconGetter = makeIconGetter("TrashIcon");

    const unpatch: Array<() => void> = [];

    // Intercept MessageStore methods to ensure edits and deletes stick across updates
    const MessageStore = (revenge as any).discord?.stores?.MessageStore;
    if (MessageStore) {
      unpatch.push(
        (revenge as any).patcher?.after(MessageStore, "getMessage", (args: any, result: any) => {
          if (!result) return result;
          const msgId = args[1] || result.id;

          if (localDeletes.has(msgId)) {
            return null;
          }

          if (localEdits.has(msgId)) {
            return {
              ...result,
              content: localEdits.get(msgId),
            };
          }

          return result;
        })
      );

      unpatch.push(
        (revenge as any).patcher?.after(MessageStore, "getMessages", (_args: any, result: any) => {
          if (!result?._array) return result;
          
          // Clean locally deleted messages from array collection
          result._array = result._array.filter((m: any) => !localDeletes.has(m?.id));
          return result;
        })
      );
    }

    // Capture target message on long press
    unpatch.push(
      onImportedPath(
        "modules/action_sheet/native/ActionSheetActionCreators.tsx",
        (ns: any) => {
          const owner = ns?.default ?? ns;
          if (typeof owner?.openLazy !== "function") return;
          unpatch.push(
            (revenge as any).patcher?.before(owner, "openLazy", (args: any) => {
              const [, key, loc] = args ?? [];
              activeMessage = key === "MessageLongPressActionSheet" ? loc?.message ?? null : null;
              return args;
            })
          );
        }
      )
    );

    // Inject rows into LongPressMessageActionSheet
    unpatch.push(
      onImportedPath(
        "modules/messages/native/long_press/LongPressMessageActionSheet.tsx",
        (ns: any) => {
          unpatch.push(installWrapper(ns));
        }
      )
    );

    cleanup(() => {
      for (const u of unpatch) u?.();
      activeMessage = null;
      localEdits.clear();
      localDeletes.clear();
      editIconGetter = () => null;
      deleteIconGetter = () => null;
    });
  },
};
