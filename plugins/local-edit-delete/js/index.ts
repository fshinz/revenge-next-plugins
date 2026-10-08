let activeMessage: any = null;

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

function hideSheet() {
  try {
    const rev = (globalThis as any).revenge;
    rev?.discord?.actions?.ActionSheetActionCreators?.hideActionSheet?.();
  } catch {}
}

function showToast(content: string) {
  try {
    const rev = (globalThis as any).revenge;
    rev?.discord?.actions?.ToastActionCreators?.showToast?.({ content });
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

function getIconComponent(iconName: string): any {
  const rev = (globalThis as any).revenge;
  try {
    if (rev?.assets?.getAssetByName) {
      return rev.assets.getAssetByName(iconName);
    }
    if (rev?.assets?.find) {
      return rev.assets.find((a: any) => a?.name === iconName);
    }
  } catch {}
  return null;
}

function makeRow(tpl: any, label: string, iconName: string, onPress: () => void): any {
  const rev = (globalThis as any).revenge;
  const React = rev?.react?.React || (globalThis as any).React;
  const Row = tpl?.type;
  if (!Row) return null;

  const Icon = Row?.Icon;
  const iconAsset = getIconComponent(iconName);
  const iconEl = Icon && iconAsset ? React.createElement(Icon, { source: iconAsset }) : null;

  return React.createElement(Row, { key: label, label, icon: iconEl, onPress });
}

function dispatchLocalEdit(message: any, newContent: string) {
  if (!message || !message.id || !message.channel_id) return;

  let content = newContent;
  if (content.endsWith("\u200b")) {
    content = content.replace(/\u200b/g, "");
  } else {
    content += "\u200b";
  }

  localEdits.set(message.id, content);

  const rev = (globalThis as any).revenge;
  const Dispatcher = rev?.discord?.stores?.Dispatcher;

  if (Dispatcher) {
    Dispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...message,
        content: content,
        edited_timestamp: new Date().toISOString(),
      },
    });
  }

  showToast("Locally edited!");
}

function openEditPrompt(message: any) {
  const currentContent = localEdits.get(message.id) ?? message.content ?? "";
  const rev = (globalThis as any).revenge;
  const Alerts = rev?.discord?.actions?.Alerts;

  if (Alerts?.show) {
    Alerts.show({
      title: "Local Edit Message",
      body: "Enter new content for this message:",
      input: {
        placeholder: "Edit content...",
        initialValue: currentContent,
      },
      confirmText: "Save",
      cancelText: "Cancel",
      onConfirm: (val: any) => {
        const text = typeof val === "string" ? val : val?.value || currentContent;
        dispatchLocalEdit(message, text);
      },
    });
  } else {
    setTimeout(() => {
      const text = prompt("Edit Local Message Content:", currentContent);
      if (text !== null) {
        dispatchLocalEdit(message, text);
      }
    }, 100);
  }
}

function triggerLocalDelete(message: any) {
  if (!message || !message.id || !message.channel_id) return;

  localDeletes.add(message.id);

  const rev = (globalThis as any).revenge;
  const Dispatcher = rev?.discord?.stores?.Dispatcher;

  if (Dispatcher) {
    Dispatcher.dispatch({
      type: "MESSAGE_DELETE",
      id: message.id,
      channel_id: message.channel_id,
    });
  }

  showToast("Locally deleted!");
}

function inject(res: any): any {
  if (!res || !activeMessage?.id) return res;

  const groups = walkRows(res);
  if (groups.length === 0) return res;

  // 1. Top Section: Local Edit Message
  const topGroup = groups[0];
  const topTpl = topGroup?.find?.((r: any) => r?.props?.label != null) ?? topGroup?.[0];

  if (topTpl) {
    const editRow = makeRow(topTpl, "Local Edit Message", "PencilSparkleIcon", () => {
      const targetMsg = activeMessage;
      hideSheet();
      openEditPrompt(targetMsg);
    });
    if (editRow) topGroup.unshift(editRow);
  }

  // 2. Last Section: Local Delete Message
  const lastGroup = groups[groups.length - 1];
  const bottomTpl = lastGroup?.find?.((r: any) => r?.props?.label != null) ?? lastGroup?.[0];

  if (bottomTpl) {
    const deleteRow = makeRow(bottomTpl, "Local Delete Message", "TrashIcon", () => {
      const targetMsg = activeMessage;
      hideSheet();
      triggerLocalDelete(targetMsg);
    });
    if (deleteRow) lastGroup.push(deleteRow);
  }

  return res;
}

export default {
  start({ cleanup }: { cleanup: (fn: () => void) => void }) {
    const rev = (globalThis as any).revenge;
    const unpatch: Array<() => void> = [];

    // Message Store Hooks
    const MessageStore = rev?.discord?.stores?.MessageStore;
    if (MessageStore) {
      unpatch.push(
        rev.patcher?.after(MessageStore, "getMessage", (args: any, result: any) => {
          if (!result) return result;
          const msgId = args[1] || result.id;

          if (localDeletes.has(msgId)) return null;

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
        rev.patcher?.after(MessageStore, "getMessages", (_args: any, result: any) => {
          if (!result) return result;
          if (Array.isArray(result._array)) {
            result._array = result._array.filter((m: any) => !localDeletes.has(m?.id));
          }
          return result;
        })
      );
    }

    // Intercept openLazy using finders instead of string paths
    const ActionSheetCreators = rev?.discord?.actions?.ActionSheetActionCreators;
    if (ActionSheetCreators?.openLazy) {
      unpatch.push(
        rev.patcher?.before(ActionSheetCreators, "openLazy", (args: any) => {
          const [, key, loc] = args ?? [];
          activeMessage = key === "MessageLongPressActionSheet" ? loc?.message ?? null : null;
          return args;
        })
      );
    }

    // Direct module injection into LongPressMessageActionSheet
    try {
      const finders = rev?.modules?.finders;
      if (finders?.getModule) {
        finders.getModule(
          (m: any) => typeof m?.default === "function" && m?.default?.name === "LongPressMessageActionSheet",
          (mod: any) => {
            if (mod?.default) {
              unpatch.push(
                rev.patcher?.after(mod, "default", (_args: any, res: any) => {
                  return activeMessage ? inject(res) : res;
                })
              );
            }
          }
        );
      }
    } catch {}

    cleanup(() => {
      for (const u of unpatch) u?.();
      activeMessage = null;
      localEdits.clear();
      localDeletes.clear();
    });
  },
};
