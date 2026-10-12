let msg: any = null
let ch: any = null

const localEdits = new Map<string, string>()
const localDeletes = new Set<string>()

let channelMessagesCache: any = null
let messageStoreRef: any = null
let messageActionCreatorsRef: any = null

function isSentMessage(m: any): boolean {
	return m?.state === 'SENT'
}

const USER_MESSAGE_TYPES = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68])

function hideSheet() {
	try {
		revenge.discord.actions?.ActionSheetActionCreators?.hideActionSheet?.()
	} catch {}
}

function showToast(content: string) {
	try {
		revenge.discord.actions?.ToastActionCreators?.showToast?.({ content })
	} catch {}
}

function removeMessage(channelId: string, messageId: string): boolean {
	try {
		if (!channelMessagesCache) return false
		const collection = channelMessagesCache.getOrCreate(channelId)
		if (!collection?.has(messageId)) return false
		const removed = collection.remove(messageId)
		channelMessagesCache.commit(removed)
		queueMicrotask(() => {
			try {
				messageStoreRef?.emitChange?.()
			} catch {}
		})
		return true
	} catch {
		return false
	}
}

function hideForMe() {
	if (!msg) return
	const channelId = ch?.id ?? msg?.channel_id ?? ''
	localDeletes.add(msg.id)
	removeMessage(channelId, msg.id)
	showToast('Locally deleted!')
}

function startLocalEdit(channelId: string, message: any) {
	if (typeof channelId !== 'string' || !message?.id) return
	const content =
		messageStoreRef?.getMessage?.(channelId, message.id)?.content ?? message.content
	try {
		messageActionCreatorsRef?.startEditMessage?.(
			channelId,
			message.id,
			content,
			'action_sheet',
		)
	} catch {}
}

function isRowArray(arr: any[]): boolean {
	if (arr.length === 0) return false
	const first = arr[0]
	return (
		first?.type?.name === 'ActionSheetRow' ||
		(first?.props && typeof first.props.label === 'string')
	)
}

function walkRows(tree: any, out: any[] = []): any[] {
	if (!tree || typeof tree !== 'object') return out
	if (Array.isArray(tree)) {
		if (isRowArray(tree) && !out.includes(tree)) out.push(tree)
		tree.forEach((c: any) => walkRows(c, out))
		return out
	}
	const k = tree?.props?.children
	if (Array.isArray(k)) {
		if (isRowArray(k) && !out.includes(k)) out.push(k)
		k.forEach((c: any) => walkRows(c, out))
	} else {
		walkRows(k, out)
	}
	return out
}

function makeRow(tpl: any, label: string, icon: any, onPress: () => void): any {
	const { React } = revenge.react
	const Row = tpl?.type
	if (!Row) return null
	const Icon = Row?.Icon
	const iconEl = Icon
		? React.createElement(Icon, { IconComponent: icon })
		: null
	return React.createElement(Row, { key: label, label, icon: iconEl, onPress })
}

const iconCache = new Map<string, any>()

function retryIcon(name: string): any {
	let icon = iconCache.get(name)
	if (!icon) {
		const wg = (revenge as any).utils?.discord?.withGeneratedIconComponent
		const filter = wg ? wg(name) : revenge.modules.finders.filters.withProps(name)
		try {
			revenge.modules.finders.getModules(
				filter,
				(exports: any) => {
					const val = exports?.[name] ?? exports?.default ?? exports
					if (val) {
						icon = val
						iconCache.set(name, val)
					}
				},
				{ returnNamespace: true },
			)
		} catch {}
	}
	return icon
}

function onImportedPath(path: string, cb: (ns: any) => void): () => void {
	try {
		return (
			revenge.discord.utils.modules.finders.getModuleWithImportedPath(
				path,
				(ns: any) => cb(ns),
			) ?? (() => {})
		)
	} catch {
		return () => {}
	}
}

function inject(res: any): any {
	if (!res || !msg?.id || !isSentMessage(msg)) return res
	const channelId = ch?.id ?? msg?.channel_id ?? ''
	const groups = walkRows(res)
	if (groups.length === 0) return res

	let editArr: any[] | null = null
	let hideArr: any[] | null = null
	for (const arr of groups) {
		if (
			!editArr &&
			arr.length > 0 &&
			arr.some((r: any) => r?.props?.label != null)
		)
			editArr = arr
		if (!hideArr && arr.some((r: any) => r?.props?.variant === 'danger'))
			hideArr = arr
		if (editArr && hideArr) break
	}

	// Local Edit Button (Top section)
	if (
		groups.length >= 2 &&
		USER_MESSAGE_TYPES.has(msg?.type) &&
		editArr
	) {
		const tpl = editArr.find((r: any) => r?.props?.label != null) ?? editArr[0]
		if (tpl) {
			editArr.unshift(
				makeRow(tpl, 'Local Edit', retryIcon('PencilIcon'), () => {
					hideSheet()
					startLocalEdit(channelId, msg)
				}),
			)
		}
	}

	// Local Delete Button (Bottom/Danger section)
	if (hideArr ?? editArr) {
		const arr = hideArr ?? editArr!
		const tpl = arr.find((r: any) => r?.props?.label != null) ?? arr[0]
		if (tpl) {
			arr.unshift(
				makeRow(tpl, 'Local Delete', retryIcon('TrashIcon'), () => {
					hideSheet()
					hideForMe()
				}),
			)
		}
	}

	return res
}

function installWrapper(ns: any) {
	const mod = ns?.default ?? ns
	if (typeof mod !== 'function') return () => {}
	const orig = mod
	const wrapped = (props: any) => {
		const res = orig(props)
		try {
			return msg ? inject(res) : res
		} catch {
			return res
		}
	}
	ns.default = wrapped
	return () => {
		if (ns.default === wrapped) ns.default = orig
	}
}

export default {
	start({ cleanup }: { cleanup: (fn: () => void) => void }) {
		const unpatch: Array<() => void> = []

		unpatch.push(
			onImportedPath('stores/MessageStore.tsx', (ns: any) => {
				messageStoreRef = ns?.default ?? ns
				if (messageStoreRef) {
					unpatch.push(
						revenge.patcher.after(messageStoreRef, 'getMessage', (args: any, result: any) => {
							if (!result) return result;
							const msgId = args[1] || result.id;
							if (localDeletes.has(msgId)) return null;
							return result;
						})
					)
				}
			}),
		)

		unpatch.push(
			onImportedPath('lib/ChannelMessages.tsx', (ns: any) => {
				channelMessagesCache = ns?.default ?? ns
			}),
		)

		unpatch.push(
			onImportedPath('actions/MessageActionCreators.tsx', (ns: any) => {
				messageActionCreatorsRef = ns?.default ?? ns
			}),
		)

		unpatch.push(
			onImportedPath(
				'modules/action_sheet/native/ActionSheetActionCreators.tsx',
				(ns: any) => {
					const owner = ns?.default ?? ns
					if (typeof owner?.openLazy !== 'function') return
					unpatch.push(
						revenge.patcher.before(owner, 'openLazy', (args: any) => {
							const [, key, loc] = args ?? []
							const m =
								key === 'MessageLongPressActionSheet' ? loc?.message : null
							if (m != null && isSentMessage(m)) {
								msg = m
								ch = loc.channel ?? null
							} else {
								msg = null
								ch = null
							}
							return args
						}),
					)
				},
			),
		)

		unpatch.push(
			onImportedPath(
				'modules/messages/native/long_press/LongPressMessageActionSheet.tsx',
				(ns: any) => {
					unpatch.push(installWrapper(ns))
				},
			),
		)

		cleanup(() => {
			for (const u of unpatch) u?.()
			msg = null
			ch = null
			localDeletes.clear()
			channelMessagesCache = null
			messageStoreRef = null
			messageActionCreatorsRef = null
		})
	},
}
