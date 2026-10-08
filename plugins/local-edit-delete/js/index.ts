import { plugin } from "@revenge-mod/plugins";

let activeMessage: any = null;
let editIconGetter: () => any = () => null;
let deleteIconGetter: () => any = () => null;

// Persistent maps to retain modified and deleted message states
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

function triggerLocalEdit(message: any) {
  const channelId = message.channel_id;
  const messageId = message.id;

  // Utilize native Discord alert modal if available, or prompt fallback
  const Alerts = (revenge as any).discord?.actions?.Alerts;
  if (Alerts?.show) {
    Alerts.show({
      title: "Local Edit Message",
      body: "Enter new local message content:",
      input: {
        placeholder: "New message text...",
        initialValue: localEdits.get(messageId) ?? message.content ?? "",
      },
      confirmText: "Save",
      cancelText: "Cancel",
      onConfirm: (text: string) => {
        applyEdit(channelId, messageId, text);
      },
    });
  } else {
    const current = localEdits.get(messageId) ?? message.content ?? "";
    const updated = prompt("Enter new local message content:", current);
    if (updated !== null) {
      applyEdit(channelId, messageId, updated);
    }
  }
}

function applyEdit(channelId: string, messageId: string, text: string) {
  localEdits.set(messageId, text);
  (revenge as any).discord?.stores?.Dispatcher?.dispatch({
    type: "MESSAGE_UPDATE",
    message: {
      id: messageId,
      channel_id: channelId,
      content: text,
      edited_timestamp: new Date().toISOString(),
    },
  });
  showToast("Locally edited!");
}

function triggerLocalDelete(message: any) {
  const channelId = message.channel_id;
  const messageId = message.id;

  localDeletes.add(messageId);
  (revenge as any).discord?.stores?.Dispatcher?.dispatch({
    type: "MESSAGE_DELETE",
    id: messageId,
    channel_id: channelId,
  });
  showToast("Locally deleted!");
}

function inject(res: any): any {
  if (!res || !activeMessage?.id) return res;

  const groups = walkRows(res);
  if (groups.length === 0) return res;

  const rowArr = groups[0];
  const tpl = rowArr?.find?.((r: any) => r?.props?.label != null) ?? rowArr?.[0];
  if (!tpl) return res;

  const editRow = makeRow(tpl, "Local Edit", editIconGetter(), () => {
    const targetMsg = activeMessage;
    hideSheet();
    triggerLocalEdit(targetMsg);
  });

  const deleteRow = makeRow(tpl, "Local Delete", deleteIconGetter(), () => {
    const targetMsg = activeMessage;
    hideSheet();
    triggerLocalDelete(targetMsg);
  });

  if (deleteRow) rowArr.unshift(deleteRow);
  if (editRow) rowArr.unshift(editRow);

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

export default plugin({
  start({ cleanup }) {
    editIconGetter = makeIconGetter("PencilIcon");
    deleteIconGetter = makeIconGetter("TrashIcon");

    const unpatch: Array<() => void> = [];

    // 1. Hook MessageStore.getMessage to maintain memory state across rerenders
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
              editedTimestamp: result.editedTimestamp || new Date().toISOString(),
            };
          }

          return result;
        })
      );
    }

    // 2. Capture target message on long press
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

    // 3. Inject rows into LongPressMessageActionSheet
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
});
