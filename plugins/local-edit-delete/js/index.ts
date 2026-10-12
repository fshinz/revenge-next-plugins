let msg: any = null;
let editIconGetter: () => any = () => null;
let deleteIconGetter: () => any = () => null;

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

function hideSheet() {
  try {
    (revenge as any).discord.actions?.ActionSheetActionCreators?.hideActionSheet?.();
  } catch {}
}

function showToast(content: string) {
  try {
    (revenge as any).discord.actions?.ToastActionCreators?.showToast?.({ content });
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
  const filter = wg ? wg(name) : (revenge as any).modules.finders.filters.withProps(name);
  let cached: any = null;
  let unsub: (() => void) | undefined;
  try {
    unsub = (revenge as any).modules.finders.getModules(
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
  if (content.endsWith("\u200b")) {
    content = content.replace(/\u200b/g, "");
  } else {
    content += "\u200b";
  }

  localEdits.set(message.id, content);

  try {
    (revenge as any).discord.stores?.Dispatcher?.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...message,
        content: content,
        edited_timestamp: new Date().toISOString(),
      },
    });
  } catch {}

  showToast("Locally edited!");
}

function LocalEditModalContent({
  message,
  onTextChange,
}: {
  message: any;
  onTextChange: (val: string) => void;
}) {
  const React = (revenge as any).react.React;
  const ReactNative = (revenge as any).react.ReactNative;
  const { View } = ReactNative;

  const Design = (revenge as any).discord.design || {};
  const TextInput = Design.TextInput || ReactNative.TextInput;
  const Text = Design.Text || ReactNative.Text;

  const initialText = localEdits.get(message.id) ?? message.content ?? "";
  const [text, setText] = React.useState(initialText);

  return React.createElement(
    View,
    { style: { width: "100%", marginTop: 8 } },
    React.createElement(
      View,
      {
        style: {
          backgroundColor: "rgba(0,0,0,0.15)",
          padding: 12,
          borderRadius: 8,
          marginBottom: 12,
          borderLeftWidth: 3,
          borderLeftColor: "#5865F2",
        },
      },
      React.createElement(
        Text,
        { variant: "text-xs/semibold", color: "text-muted", style: { marginBottom: 4 } },
        "ORIGINAL MESSAGE PREVIEW:"
      ),
      React.createElement(
        Text,
        { variant: "text-sm/normal", color: "text-default" },
        message.content || "(empty)"
      )
    ),
    React.createElement(TextInput, {
      placeholder: "Write new message content...",
      value: text,
      multiline: true,
      autoFocus: true,
      onChangeText: (val: string) => {
        setText(val);
        onTextChange(val);
      },
      style: {
        minHeight: 80,
        textAlignVertical: "top",
        padding: 8,
        borderRadius: 8,
        backgroundColor: "rgba(0,0,0,0.1)",
      },
    })
  );
}

function openEditAlert(message: any) {
  let pendingText = localEdits.get(message.id) ?? message.content ?? "";
  const alertKey = "LocalEditAlertModal";
  const React = (revenge as any).react.React;
  const Alerts = (revenge as any).discord.actions?.AlertActionCreators || (revenge as any).discord.actions?.Alerts;
  const Design = (revenge as any).discord.design || {};

  if (Alerts?.openAlert && Design.AlertModal && Design.AlertActionButton) {
    Alerts.openAlert(
      alertKey,
      React.createElement(Design.AlertModal, {
        title: "Local Edit Message",
        content: React.createElement(LocalEditModalContent, {
          message,
          onTextChange: (val: string) => {
            pendingText = val;
          },
        }),
        actions: React.createElement(
          React.Fragment,
          null,
          React.createElement(Design.AlertActionButton, {
            text: "Save",
            variant: "primary",
            onPress: () => {
              Alerts.dismissAlert(alertKey);
              dispatchLocalEdit(message, pendingText);
            },
          }),
          React.createElement(Design.AlertActionButton, {
            text: "Cancel",
            variant: "secondary",
            onPress: () => Alerts.dismissAlert(alertKey),
          })
        ),
      })
    );
  } else {
    const res = prompt("Edit Message Locally:", pendingText);
    if (res !== null) {
      dispatchLocalEdit(message, res);
    }
  }
}

function triggerLocalDelete(message: any) {
  if (!message || !message.id || !message.channel_id) return;

  localDeletes.add(message.id);

  try {
    (revenge as any).discord.stores?.Dispatcher?.dispatch({
      type: "MESSAGE_DELETE",
      id: message.id,
      channel_id: message.channel_id,
    });
  } catch {}

  showToast("Locally deleted!");
}

function inject(res: any): any {
  if (!res || !msg?.id) return res;

  const groups = walkRows(res);
  if (groups.length === 0) return res;

  // 1. Top Section: Local Edit Message
  const topGroup = groups[0];
  const topTpl = topGroup?.find?.((r: any) => r?.props?.label != null) ?? topGroup?.[0];

  if (topTpl) {
    const targetMsg = msg;
    const editRow = makeRow(topTpl, "Local Edit Message", editIconGetter(), () => {
      hideSheet();
      setTimeout(() => {
        openEditAlert(targetMsg);
      }, 100);
    });
    if (editRow) topGroup.unshift(editRow);
  }

  // 2. Last Section: Local Delete Message
  const lastGroup = groups[groups.length - 1];
  const bottomTpl = lastGroup?.find?.((r: any) => r?.props?.label != null) ?? lastGroup?.[0];

  if (bottomTpl) {
    const targetMsg = msg;
    const deleteRow = makeRow(bottomTpl, "Local Delete Message", deleteIconGetter(), () => {
      hideSheet();
      setTimeout(() => {
        triggerLocalDelete(targetMsg);
      }, 100);
    });
    if (deleteRow) lastGroup.push(deleteRow);
  }

  return res;
}

function installWrapper(ns: any) {
  const mod = ns?.default ?? ns;
  if (typeof mod !== "function") return () => {};
  const orig = mod;
  const wrapped = (props: any) => {
    const res = orig(props);
    try {
      return msg ? inject(res) : res;
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
      (revenge as any).discord.utils.modules.finders.getModuleWithImportedPath(
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

    // Message Store Memory Hooks
    const MessageStore = (revenge as any).discord.stores?.MessageStore;
    if (MessageStore) {
      unpatch.push(
        (revenge as any).patcher.after(MessageStore, "getMessage", (args: any, result: any) => {
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
        (revenge as any).patcher.after(MessageStore, "getMessages", (_args: any, result: any) => {
          if (!result) return result;
          if (Array.isArray(result._array)) {
            result._array = result._array.filter((m: any) => !localDeletes.has(m?.id));
          }
          return result;
        })
      );
    }

    // Intercept Target Message
    unpatch.push(
      onImportedPath(
        "modules/action_sheet/native/ActionSheetActionCreators.tsx",
        (ns: any) => {
          const owner = ns?.default ?? ns;
          if (typeof owner?.openLazy !== "function") return;
          unpatch.push(
            (revenge as any).patcher.before(owner, "openLazy", (args: any) => {
              const [, key, loc] = args ?? [];
              msg = key === "MessageLongPressActionSheet" ? loc?.message ?? null : null;
              return args;
            })
          );
        }
      )
    );

    // Inject Long Press Action Sheet Rows
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
      msg = null;
      localEdits.clear();
      localDeletes.clear();
      editIconGetter = () => null;
      deleteIconGetter = () => null;
    });
  },
};
