import { plugin } from "@revenge-mod/plugins";
import { createPatcher } from "@revenge-mod/patcher";
import { getModules } from "@revenge-mod/modules/finders";
import { withProps } from "@revenge-mod/modules/finders/filters";
import { Stores } from "@revenge-mod/discord";

const patcher = createPatcher();

// Memory stores for local client overrides
const localEdits = new Map<string, string>();
const localDeletes = new Set<string>();

export default plugin({
  start() {
    // 1. Intercept MessageStore.getMessage to serve modified or deleted states
    const MessageStore = Stores.MessageStore;
    if (MessageStore) {
      patcher.after(MessageStore, "getMessage", (args, result) => {
        if (!result) return result;

        const messageId = args[1] || result.id;

        // If marked locally deleted, suppress message return
        if (localDeletes.has(messageId)) {
          return null;
        }

        // If locally edited, override message content on the fly
        if (localEdits.has(messageId)) {
          return {
            ...result,
            content: localEdits.get(messageId),
            editedTimestamp: result.editedTimestamp || new Date().toISOString(),
          };
        }

        return result;
      });
    }

    // 2. Patch MessageActions/Dispatchers to expose local trigger functions
    const MessageActions = getModules(withProps("editMessage", "deleteMessage"))[0];

    if (MessageActions) {
      // Expose globally for quick testing / command execution
      (globalThis as any).localEditMessage = (channelId: string, messageId: string, newContent: string) => {
        localEdits.set(messageId, newContent);
        // Dispatch Flux event to force React component rerender in channel
        Stores.Dispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: {
            id: messageId,
            channel_id: channelId,
            content: newContent,
          },
        });
      };

      (globalThis as any).localDeleteMessage = (channelId: string, messageId: string) => {
        localDeletes.add(messageId);
        // Dispatch Flux event to remove message from active view
        Stores.Dispatcher.dispatch({
          type: "MESSAGE_DELETE",
          id: messageId,
          channel_id: channelId,
        });
      };
    }
  },

  stop() {
    // Unpatch all hooks on plugin unload
    patcher.unpatchAll();
    localEdits.clear();
    localDeletes.clear();
    delete (globalThis as any).localEditMessage;
    delete (globalThis as any).localDeleteMessage;
  },
});
