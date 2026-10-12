import * as React from "react";
import * as ReactNative from "react-native";

import * as assets from "@revenge-mod/assets";
import * as actions from "@revenge-mod/discord/actions";
import { AlertActionCreators, ActionSheetActionCreators } from "@revenge-mod/discord/actions";
import { Design } from "@revenge-mod/discord/design";
import { Stores } from "@revenge-mod/discord/flux";
import * as finders from "@revenge-mod/modules/finders";
import * as filters from "@revenge-mod/modules/finders/filters";
import { before, after } from "@revenge-mod/patcher";

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

function showToast(content: string) {
  try {
    actions.ToastActionCreators?.showToast?.({ content });
  } catch {}
}

function findInReactTree(root: any, predicate: (node: any) => boolean, depth = 0): any {
  if (!root || typeof root !== "object" || depth > 30) return undefined;
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
  } else if (children && typeof children === "object") {
    const found = findInReactTree(children, predicate, depth + 1);
    if (found) return found;
  }

  return undefined;
}

let actionSheetRow: any;
function getActionSheetRow() {
  if (!actionSheetRow) {
    try {
      actionSheetRow = finders.lookupModule<any>(filters.withProps("ActionSheetRow"))?.[0]?.ActionSheetRow;
    } catch {}
  }
  return actionSheetRow;
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
    Stores.Dispatcher?.dispatch({
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
  const { View } = ReactNative;
  const { TextInput, Text } = Design;

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

  try {
    AlertActionCreators.openAlert(
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
              AlertActionCreators.dismissAlert(alertKey);
              dispatchLocalEdit(message, pendingText);
            },
          }),
          React.createElement(Design.AlertActionButton, {
            text: "Cancel",
            variant: "secondary",
            onPress: () => AlertActionCreators.dismissAlert(alertKey),
          })
        ),
      })
    );
  } catch {
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
    Stores.Dispatcher?.dispatch({
      type: "MESSAGE_DELETE",
      id: message.id,
      channel_id: message.channel_id,
    });
  } catch {}

  showToast("Locally deleted!");
}

function inject(rendered: any, target: any): boolean {
  const ActionSheetRow = getActionSheetRow();
  if (!ActionSheetRow) return false;

  const editRow = React.createElement(ActionSheetRow, {
    key: "local-edit-row",
    label: "Local Edit Message",
    subLabel: "Modify content visible only to you",
    icon: React.createElement(ActionSheetRow.Icon, {
      source: assets.getAssetIdByName("PencilSparkleIcon"),
    }),
    onPress: () => {
      try {
        ActionSheetActionCreators.hideActionSheet();
      } catch {}
      openEditAlert(target);
    },
  });

  const deleteRow = React.createElement(ActionSheetRow, {
    key: "local-delete-row",
    label: "Local Delete Message",
    subLabel: "Hide message locally",
    icon: React.createElement(ActionSheetRow.Icon, {
      source: assets.getAssetIdByName("TrashIcon"),
    }),
    onPress: () => {
      try {
        ActionSheetActionCreators.hideActionSheet();
      } catch {}
      triggerLocalDelete(target);
    },
  });

  const groups = findInReactTree(
    rendered,
    (c: any) =>
      Array.isArray(c) &&
      c.some(
        (item: any) =>
          item?.type === ActionSheetRow || item?.type?.name === "ActionSheetRowGroup"
      )
  );

  if (Array.isArray(groups)) {
    groups.unshift(
      React.createElement(ActionSheetRow.Group, { key: "local-edit-group" }, editRow)
    );
    groups.push(
      React.createElement(ActionSheetRow.Group, { key: "local-delete-group" }, deleteRow)
    );
    return true;
  }

  return false;
}

export default function plugin() {
  return {
    start(api: any) {
      const { cleanup } = api;
      const patches: Array<() => void> = [];

      // Patch MessageStore to override returns for local edits and deletes
      const MessageStore = Stores.MessageStore;
      if (MessageStore) {
        patches.push(
          after(MessageStore, "getMessage", (args: any, result: any) => {
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

        patches.push(
          after(MessageStore, "getMessages", (_args: any, result: any) => {
            if (!result) return result;
            if (Array.isArray(result._array)) {
              result._array = result._array.filter((m: any) => !localDeletes.has(m?.id));
            }
            return result;
          })
        );
      }

      // Hook openLazy to patch the long-press action sheet instance dynamically
      patches.push(
        before(ActionSheetActionCreators as any, "openLazy", (args: any[]) => {
          try {
            const [sheetPromise, key, props] = args;
            const message = props?.message;

            if (
              typeof key === "string" &&
              /message/i.test(key) &&
              message?.id &&
              sheetPromise &&
              typeof sheetPromise.then === "function"
            ) {
              args[0] = sheetPromise.then((mod: any) => {
                if (mod && typeof mod.default === "function") {
                  patches.push(
                    after(mod, "default", (_: any, rendered: any) => {
                      if (rendered) {
                        inject(rendered, message);
                      }
                      return rendered;
                    })
                  );
                }
                return mod;
              });
            }
          } catch {}
          return args;
        })
      );

      cleanup(() => {
        for (const unpatch of patches) {
          try {
            unpatch();
          } catch {}
        }
        localEdits.clear();
        localDeletes.clear();
      });
    },
  };
}
