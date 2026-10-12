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

function findInReactTree(root: any, predicate: (node: any) => boolean, depth = 0): any {
  if (!root || typeof root !== 'object' || depth > 30) return undefined;
  if (predicate(root)) return root;

  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findInReactTree(entry, predicate, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  const children = root.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findInReactTree(child, predicate, depth + 1);
      if (found) return found;
    }
  } else if (children && typeof children === 'object') {
    const found = findInReactTree(children, predicate, depth + 1);
    if (found) return found;
  }

  return undefined;
}

let actionSheetRow: any;
function ActionSheetRowComponent() {
  if (!actionSheetRow) {
    const rev = (globalThis as any).revenge;
    const finders = rev?.modules?.finders;
    if (finders?.lookupModule) {
      actionSheetRow = finders.lookupModule<any>(finders.filters.withProps('ActionSheetRow'))?.[0]?.ActionSheetRow;
    }
  }
  return actionSheetRow;
}

function findGroupParent(tree: any): any {
  const rev = (globalThis as any).revenge;
  const Design = rev?.discord?.design;
  const ActionSheetRow = ActionSheetRowComponent();
  
  return findInReactTree(tree, (c: any) => {
    if (Array.isArray(c) && c.some((child: any) => child?.type === ActionSheetRow || child?.type?.name === 'ActionSheetRowGroup')) {
      return true;
    }
    return c?.type?.name === 'ActionSheetRowGroup';
  });
}

function getAssetId(name: string) {
  try {
    const rev = (globalThis as any).revenge;
    return rev?.assets?.getAssetIdByName?.(name) ?? rev?.assets?.getAssetByName?.(name);
  } catch {
    return null;
  }
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

// Interactive Preview Modal Component
function LocalEditModalContent({ message, onTextChange }: { message: any; onTextChange: (val: string) => void }) {
  const rev = (globalThis as any).revenge;
  const React = rev?.react?.React || (globalThis as any).React;
  const ReactNative = rev?.externals?.reactNative || rev?.reactNative || (globalThis as any).ReactNative;
  const TextInput = rev?.discord?.design?.TextInput || ReactNative?.TextInput;
  const Text = rev?.discord?.design?.Text || ReactNative?.Text;
  const View = ReactNative?.View || "View";

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
        }
      },
      React.createElement(Text, { variant: "text-xs/semibold", color: "text-muted", style: { marginBottom: 4 } }, "ORIGINAL MESSAGE PREVIEW:"),
      React.createElement(Text, { variant: "text-sm/normal", color: "text-default" }, message.content || "(empty)")
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
      }
    })
  );
}

function openEditAlert(message: any) {
  const rev = (globalThis as any).revenge;
  const Alerts = rev?.discord?.actions?.AlertActionCreators || rev?.discord?.actions?.Alerts;
  const Design = rev?.discord?.design;
  const React = rev?.react?.React;

  let pendingText = localEdits.get(message.id) ?? message.content ?? "";

  if (Alerts?.openAlert && Design?.AlertModal && Design?.AlertActionButton) {
    const alertKey = "LocalEditAlertModal";
    Alerts.openAlert(
      alertKey,
      React.createElement(Design.AlertModal, {
        title: "Local Edit Message",
        content: React.createElement(LocalEditModalContent, {
          message,
          onTextChange: (val: string) => { pendingText = val; }
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
            }
          }),
          React.createElement(Design.AlertActionButton, {
            text: "Cancel",
            variant: "secondary",
            onPress: () => Alerts.dismissAlert(alertKey)
          })
        )
      })
    );
  } else {
    // Fallback if native AlertModal isn't loaded
    const res = prompt("Edit Message Locally:", pendingText);
    if (res !== null) {
      dispatchLocalEdit(message, res);
    }
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

function inject(rendered: any, target: any): boolean {
  const ActionSheetRow = ActionSheetRowComponent();
  if (!ActionSheetRow) return false;

  const rev = (globalThis as any).revenge;
  const React = rev?.react?.React;

  const editRow = React.createElement(ActionSheetRow, {
    key: "local-edit-row",
    label: "Local Edit Message",
    subLabel: "Modify content visible only to you",
    icon: React.createElement(ActionSheetRow.Icon, { source: getAssetId("PencilSparkleIcon") }),
    onPress: () => {
      hideSheet();
      openEditAlert(target);
    }
  });

  const deleteRow = React.createElement(ActionSheetRow, {
    key: "local-delete-row",
    label: "Local Delete Message",
    subLabel: "Hide message locally",
    icon: React.createElement(ActionSheetRow.Icon, { source: getAssetId("TrashIcon") }),
    onPress: () => {
      hideSheet();
      triggerLocalDelete(target);
    }
  });

  const groups = findInReactTree(rendered, (c: any) => Array.isArray(c) && c.some((item: any) => item?.type === ActionSheetRow || item?.type?.name === 'ActionSheetRowGroup'));

  if (Array.isArray(groups)) {
    // Add Edit to the TOP group
    groups.unshift(
      React.createElement(ActionSheetRow.Group, { key: "local-edit-group" }, editRow)
    );
    // Add Delete to the LAST group (beside native delete/report)
    groups.push(
      React.createElement(ActionSheetRow.Group, { key: "local-delete-group" }, deleteRow)
    );
    return true;
  }

  return false;
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

    // Intercept openLazy to grab the target message reference securely
    const ActionSheetCreators = rev?.discord?.actions?.ActionSheetActionCreators;
    if (ActionSheetCreators?.openLazy) {
      unpatch.push(
        rev.patcher?.before(ActionSheetCreators, "openLazy", (args: any) => {
          try {
            const [sheet, key, props] = args;
            if (key === "MessageLongPressActionSheet" && props?.message) {
              const target = props.message;
              args[0] = sheet.then((mod: any) => {
                if (mod && typeof mod.default === "function") {
                  const original = mod.default;
                  mod.default = (p: any) => {
                    const res = original(p);
                    try {
                      inject(res, target);
                    } catch {}
                    return res;
                  };
                }
                return mod;
              });
            }
          } catch {}
          return args;
        })
      );
    }

    cleanup(() => {
      for (const u of unpatch) u?.();
      activeMessage = null;
      localEdits.clear();
      localDeletes.clear();
    });
  },
};
