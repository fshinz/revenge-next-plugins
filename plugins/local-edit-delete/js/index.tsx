let msg: any = null;
let ch: any = null;

const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

let channelMessagesCache: any = null;
let messageStoreRef: any = null;

function isSentMessage(m: any): boolean {
  return m?.state === "SENT";
}

const ALERT_KEY = "local-edit-preview";
const USER_MESSAGE_TYPES = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68]);

function hideSheet() {
  try {
    revenge.discord.actions?.ActionSheetActionCreators?.hideActionSheet?.();
  } catch {}
}

function showToast(content: string) {
  try {
    revenge.discord.actions?.ToastActionCreators?.open?.("local-edit-delete", {
      text: content,
    });
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

// Copies a message while keeping its prototype, so Discord's message
// helper methods still work on the copy.
function cloneMessage(m: any, content: string): any {
  const clone = Object.create(Object.getPrototypeOf(m));
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(m));
  clone.content = content;
  return clone;
}

function applyLocalEdit(channelId: string, messageId: string, content: string) {
  localEdits.set(messageId, content);

  // Swap in a copy of the cached message so the author and other fields stay intact.
  try {
    const collection = channelMessagesCache?.getOrCreate(channelId);
    if (collection?.has(messageId)) {
      channelMessagesCache.commit(
        collection.update(messageId, (m: any) => cloneMessage(m, content))
      );
      queueMicrotask(() => {
        try {
          messageStoreRef?.emitChange?.();
        } catch {}
      });
    }
  } catch {}

  showToast("Locally edited!");
}

// Markdown preview

function renderPreview(source: string) {
  const { React } = revenge.react;
  const { Text } = revenge.discord.design.Design;

  const renderInline = (line: string, keyPrefix: string) => {
    const parts: any[] = [];
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|`[^`]+`)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = pattern.exec(line))) {
      if (match.index > last) parts.push(line.slice(last, match.index));

      const token = match[0];
      const body = token.replace(/^(\*\*|__|~~|\*|_|`)|(\*\*|__|~~|\*|_|`)$/g, "");
      let style: any = { fontStyle: "italic" };
      if (token.startsWith("**") || token.startsWith("__")) {
        style = { fontWeight: "bold" };
      } else if (token.startsWith("~~")) {
        style = { textDecorationLine: "line-through" };
      } else if (token.startsWith("`")) {
        style = {
          fontFamily: "monospace",
          backgroundColor: "rgba(127,127,127,0.25)",
        };
      }

      parts.push(
        React.createElement(
          Text,
          { key: `${keyPrefix}-${index++}`, variant: "text-md/medium", style },
          body
        )
      );
      last = match.index + token.length;
    }

    if (last < line.length) parts.push(line.slice(last));
    return parts;
  };

  return source.split("\n").map((line, i) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const variant = ["heading-xl/bold", "heading-lg/bold", "heading-md/bold"][
        heading[1].length - 1
      ];
      return React.createElement(
        Text,
        { key: i, variant, style: { marginVertical: 4 } },
        renderInline(heading[2], `h${i}`)
      );
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      return React.createElement(
        Text,
        {
          key: i,
          variant: "text-md/medium",
          style: {
            paddingLeft: 8,
            borderLeftWidth: 3,
            borderLeftColor: "rgba(127,127,127,0.6)",
          },
        },
        renderInline(quote[1], `q${i}`)
      );
    }

    return React.createElement(
      Text,
      { key: i, variant: "text-md/medium", style: { minHeight: line ? undefined : 8 } },
      renderInline(line, `l${i}`)
    );
  });
}

// Local Edit Preview dialog

type Author = { name: string; avatarUrl?: string; time?: string };

function getAuthor(message: any): Author {
  const user = message?.author;
  const name = user?.globalName ?? user?.global_name ?? user?.username ?? "";
  const avatarUrl =
    user?.id && user?.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : undefined;
  let time: string | undefined;
  try {
    time = message?.timestamp?.format?.("MM/DD/YYYY h:mm A");
  } catch {}
  return { name, avatarUrl, time };
}

function LocalEditDialog(props: {
  channelId: string;
  messageId: string;
  initial: string;
  author: Author;
}) {
  const { React } = revenge.react;
  const { ScrollView, View, Image, Dimensions, Keyboard } = revenge.react.ReactNative;
  const { AlertModal, AlertActionButton, Text, TextArea } =
    revenge.discord.design.Design;
  const [text, setText] = React.useState(props.initial);
  const [typing, setTyping] = React.useState(false);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const windowHeight = Dimensions.get("window").height;

  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e: any) =>
      setKeyboardHeight(e?.endCoordinates?.height ?? 0)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Space above the keyboard. Focus is the fallback if the keyboard events never fire.
  const keyboard = typing ? keyboardHeight || windowHeight * 0.4 : 0;
  // Title, buttons and padding take roughly this much of the dialog.
  const FIXED_PARTS = 320;
  const budget = Math.max(150, windowHeight - keyboard - FIXED_PARTS);
  const previewHeight = keyboard ? Math.round(budget * 0.5) : Math.round(windowHeight * 0.3);
  const inputHeight = keyboard ? Math.round(budget * 0.5) : Math.round(windowHeight * 0.18);
  const { author } = props;

  const close = () => {
    try {
      revenge.discord.actions?.AlertActionCreators?.dismissAlert?.(ALERT_KEY);
    } catch {}
  };

  const save = () => {
    close();
    if (!text.length || text === props.initial) return;
    setTimeout(() => applyLocalEdit(props.channelId, props.messageId, text), 300);
  };

  const header = React.createElement(
    View,
    { style: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 } },
    author.avatarUrl
      ? React.createElement(Image, {
          source: { uri: author.avatarUrl },
          style: { width: 36, height: 36, borderRadius: 18 },
        })
      : null,
    React.createElement(Text, { variant: "text-md/bold" }, author.name),
    author.time
      ? React.createElement(
          Text,
          { variant: "text-xs/medium", color: "text-muted" },
          author.time
        )
      : null
  );

  return React.createElement(AlertModal, {
    title: "Local Edit Preview",
    // extraContent spans the full dialog width; content is indented for plain text.
    extraContent: React.createElement(
      View,
      { style: { alignSelf: "stretch", gap: 12 } },
      // The preview is only as tall as the message, up to previewHeight.
      React.createElement(
        ScrollView,
        {
          style: { maxHeight: previewHeight, flexGrow: 0 },
          nestedScrollEnabled: true,
          keyboardShouldPersistTaps: "handled",
        },
        author.name ? header : null,
        renderPreview(text)
      ),
      React.createElement(
        View,
        { style: { height: inputHeight, overflow: "hidden" } },
        React.createElement(TextArea, {
          style: { height: inputHeight },
          value: text,
          onChange: setText,
          onFocus: () => setTyping(true),
          onBlur: () => setTyping(false),
          placeholder: "Message",
        })
      )
    ),
    actions: React.createElement(
      View,
      { style: { gap: 8 } },
      React.createElement(AlertActionButton, {
        text: "Save",
        variant: "primary",
        onPress: save,
      }),
      React.createElement(AlertActionButton, {
        text: "Cancel",
        variant: "secondary",
        onPress: close,
      })
    ),
  });
}

function openLocalEdit(channelId: string, message: any) {
  const initial =
    localEdits.get(message.id) ??
    messageStoreRef?.getMessage?.(channelId, message.id)?.content ??
    message.content ??
    "";

  hideSheet();
  revenge.discord.actions?.AlertActionCreators?.openAlert?.(
    ALERT_KEY,
    revenge.react.React.createElement(LocalEditDialog, {
      channelId,
      messageId: message.id,
      initial,
      author: getAuthor(message),
    })
  );
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

  // Local Edit Row
  if (groups.length >= 2 && USER_MESSAGE_TYPES.has(msg?.type) && editArr) {
    const tpl = editArr.find((r: any) => r?.props?.label != null) ?? editArr[0];
    if (tpl) {
      editArr.unshift(
        makeRow(tpl, "Local Edit Message", retryIcon("PencilIcon"), () => {
          hideSheet();
          openLocalEdit(channelId, msg);
        })
      );
    }
  }

  // Local Delete Row
  if (hideArr ?? editArr) {
    const arr = hideArr ?? editArr!;
    const tpl = arr.find((r: any) => r?.props?.label != null) ?? arr[0];
    if (tpl) {
      arr.unshift(
        makeRow(tpl, "Local Delete Message", retryIcon("TrashIcon"), () => {
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

    // 1. Override getMessage in MessageStore for active session
    unpatch.push(
      onImportedPath("stores/MessageStore.tsx", (ns: any) => {
        messageStoreRef = ns?.default ?? ns;
        if (messageStoreRef) {
          unpatch.push(
            revenge.patcher.instead(
              messageStoreRef,
              "getMessage",
              function (this: any, args: any[], original: any) {
                const result = original.apply(this, args);
                if (!result) return result;
                const msgId = args[1] || result.id;

                if (localDeletes.has(msgId)) return null;

                const edited = localEdits.get(msgId);
                if (edited != null && result.content !== edited) {
                  return cloneMessage(result, edited);
                }

                return result;
              }
            )
          );
        }
      })
    );

    // 2. Store reference to ChannelMessages cache
    unpatch.push(
      onImportedPath("lib/ChannelMessages.tsx", (ns: any) => {
        channelMessagesCache = ns?.default ?? ns;
      })
    );

    // 3. Intercept long press openLazy
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

    // 4. Inject Action Sheet Options
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
      localEdits.clear();
      localDeletes.clear();
      channelMessagesCache = null;
      messageStoreRef = null;
    });
  },
};
