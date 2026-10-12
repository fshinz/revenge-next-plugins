let msg: any = null;
let ch: any = null;

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

let pendingLocalEdit: { channelId: string; messageId: string } | null = null;

let channelMessagesCache: any = null;
let messageStoreRef: any = null;
let messageActionCreatorsRef: any = null;

function isSentMessage(m: any): boolean {
  return m?.state === "SENT";
}

const USER_MESSAGE_TYPES = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68]);

function hideSheet() {
  try {
    revenge.discord.actions?.ActionSheetActionCreators?.hideActionSheet?.();
  } catch {}
}

function showToast(content: string) {
  try {
    revenge.discord.actions?.ToastActionCreators?.showToast?.({ content });
  } catch {}
}

function removeMessage(channelId: string, messageId: string): boolean {
  try {
    if (!channelMessagesCache) return false;
    const collection = channelMessagesCache.getOrCreate(channelId);
    if (!collection?.has(messageId)) return false;
    const removed = collection.remove(messageId);
    channelMessagesCache.commit(removed);
    queueMicrotask(() => {
      try {
        messageStoreRef?.emitChange?.();
      } catch {}
    });
    return true;
  } catch {
    return false;
  }
}

function hideForMe() {
  if (!msg) return;
  const channelId = ch?.id ?? msg?.channel_id ?? "";
  localDeletes.add(msg.id);
  removeMessage(channelId, msg.id);
  showToast("Locally deleted!");
}

function startLocalEdit(channelId: string, message: any) {
  if (typeof channelId !== "string" || !message?.id) return;

  // Mark this message as a pending local edit session
  pendingLocalEdit = { channelId, messageId: message.id };

  const content =
    localEdits.get(message.id) ??
    messageStoreRef?.getMessage?.(channelId, message.id)?.content ??
    message.content ??
    "";

  try {
    messageActionCreatorsRef?.startEditMessage?.(
      channelId,
      message.id,
      content,
      "action_sheet"
    );
  } catch {}
}

function isRowArray(arr: any[]): boolean {
  if (arr.length === 0) return false;
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

function makeRow(tpl: any, label: string, icon: any, onPress: () => void): any {
  const { React } = revenge.react;
  const Row = tpl?.type;
  if (!Row) return null;
  const Icon = Row?.Icon;
  const iconEl = Icon ? React.createElement(Icon, { IconComponent: icon }) : null;
  return React.createElement(Row, { key: label, label, icon: iconEl, onPress });
}

const iconCache = new Map<string, any>();

function retryIcon(name: string): any {
  let icon = iconCache.get(name);
  if (!icon) {
    const wg = (revenge as any).utils?.discord?.withGeneratedIconComponent;
    const filter = wg ? wg(name) : revenge.modules.finders.filters.withProps(name);
    try {
      revenge.modules.finders.getModules(
        filter,
        (exports: any) => {
          const val = exports?.[name] ?? exports?.default ?? exports;
          if (val) {
            icon = val;
            iconCache.set(name, val);
          }
        },
        { returnNamespace: true }
      );
    } catch {}
  }
  return icon;
}

function onImportedPath(path: string, cb: (ns: any) => void): () => void {
  try {
    return (
      revenge.discord.utils.modules.finders.getModuleWithImportedPath(
        path,
        (ns: any) => cb(ns)
      ) ?? (() => {})
    );
  } catch {
    return () => {};
  }
}

function inject(res: any): any {
  if (!res || !msg?.id || !isSentMessage(msg)) return res;
  const channelId = ch?.id ?? msg?.channel_id ?? "";
  const groups = walkRows(res);
  if (groups.length === 0) return res;

  let editArr: any[] | null = null;
  let hideArr: any[] | null = null;
  for (const arr of groups) {
    if (!editArr && arr.length > 0 && arr.some((r: any) => r?.props?.label != null))
      editArr = arr;
    if (!hideArr && arr.some((r: any) => r?.props?.variant === "danger"))
      hideArr = arr;
    if (editArr && hideArr) break;
  }

  // Local Edit Button
  if (groups.length >= 2 && USER_MESSAGE_TYPES.has(msg?.type) && editArr) {
    const tpl = editArr.find((r: any) => r?.props?.label != null) ?? editArr[0];
    if (tpl) {
      editArr.unshift(
        makeRow(tpl, "Local Edit", retryIcon("PencilIcon"), () => {
          hideSheet();
          startLocalEdit(channelId, msg);
        })
      );
    }
  }

  // Local Delete Button
  if (hideArr ?? editArr) {
    const arr = hideArr ?? editArr!;
    const tpl = arr.find((r: any) => r?.props?.label != null) ?? arr[0];
    if (tpl) {
      arr.unshift(
        makeRow(tpl, "Local Delete", retryIcon("TrashIcon"), () => {
          hideSheet();
          hideForMe();
        })
      );
    }
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

export default {
  start({ cleanup }: { cleanup: (fn: () => void) => void }) {
    const unpatch: Array<() => void> = [];

    // 1. MessageStore Patching for Local Edits & Deletes
    unpatch.push(
      onImportedPath("stores/MessageStore.tsx", (ns: any) => {
        messageStoreRef = ns?.default ?? ns;
        if (messageStoreRef) {
          unpatch.push(
            revenge.patcher.after(
              messageStoreRef,
              "getMessage",
              (args: any, result: any) => {
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
              }
            )
          );
        }
      })
    );

    // 2. Channel Messages Cache Reference
    unpatch.push(
      onImportedPath("lib/ChannelMessages.tsx", (ns: any) => {
        channelMessagesCache = ns?.default ?? ns;
      })
    );

    // 3. Intercept Composer Edit Submissions
    unpatch.push(
      onImportedPath("actions/MessageActionCreators.tsx", (ns: any) => {
        messageActionCreatorsRef = ns?.default ?? ns;
        if (messageActionCreatorsRef?.editMessage) {
          unpatch.push(
            revenge.patcher.instead(
              messageActionCreatorsRef,
              "editMessage",
              (args: any[], original: any) => {
                const channelId = args[0];
                const messageId = args[1];
                const parsed = args[2];

                // Check if this submit originated from our local edit action
                if (
                  pendingLocalEdit &&
                  pendingLocalEdit.channelId === channelId &&
                  pendingLocalEdit.messageId === messageId
                ) {
                  pendingLocalEdit = null;
                  let newContent =
                    typeof parsed?.content === "string" ? parsed.content : "";

                  if (!newContent.endsWith("\u200b")) {
                    newContent += "\u200b";
                  }

                  localEdits.set(messageId, newContent);

                  const Dispatcher = revenge.discord.stores?.Dispatcher;
                  const currentMsg = messageStoreRef?.getMessage?.(
                    channelId,
                    messageId
                  );

                  if (Dispatcher && currentMsg) {
                    Dispatcher.dispatch({
                      type: "MESSAGE_UPDATE",
                      message: {
                        ...currentMsg,
                        id: messageId,
                        channel_id: channelId,
                        content: newContent,
                        edited_timestamp: new Date().toISOString(),
                      },
                    });
                  }

                  // Force cell re-render
                  try {
                    if (channelMessagesCache) {
                      const collection =
                        channelMessagesCache.getOrCreate(channelId);
                      if (collection?.has(messageId)) {
                        const updated = collection.update(
                          messageId,
                          (m: any) => {
                            const descriptors =
                              Object.getOwnPropertyDescriptors(m);
                            const clone = Object.create(
                              Object.getPrototypeOf(m)
                            );
                            Object.defineProperties(clone, descriptors);
                            clone.content = newContent;
                            return clone;
                          }
                        );
                        channelMessagesCache.commit(updated);
                        queueMicrotask(() => {
                          messageStoreRef?.emitChange?.();
                        });
                      }
                    }
                  } catch {}

                  showToast("Locally edited!");
                  return Promise.resolve(); // Cancel remote API request
                }

                return original(...args);
              }
            )
          );
        }
      })
    );

    // 4. Action Sheet Target Message Capture
    unpatch.push(
      onImportedPath(
        "modules/action_sheet/native/ActionSheetActionCreators.tsx",
        (ns: any) => {
          const owner = ns?.default ?? ns;
          if (typeof owner?.openLazy !== "function") return;
          unpatch.push(
            revenge.patcher.before(owner, "openLazy", (args: any) => {
              const [, key, loc] = args ?? [];
              const m =
                key === "MessageLongPressActionSheet" ? loc?.message : null;
              if (m != null && isSentMessage(m)) {
                msg = m;
                ch = loc.channel ?? null;
              } else {
                msg = null;
                ch = null;
              }
              return args;
            })
          );
        }
      )
    );

    // 5. Inject Context Menu Items
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
      ch = null;
      pendingLocalEdit = null;
      localEdits.clear();
      localDeletes.clear();
      channelMessagesCache = null;
      messageStoreRef = null;
      messageActionCreatorsRef = null;
    });
  },
};
