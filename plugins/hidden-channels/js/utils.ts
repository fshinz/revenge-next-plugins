import { Stores } from '@revenge-mod/discord/flux'

export interface Settings {
	showIcon: boolean
	showPopup: boolean
}

export const DEFAULT_SETTINGS: Settings = {
	showIcon: true,
	showPopup: true,
}

// Discord channel types: DM, GROUP_DM, GUILD_CATEGORY
const SKIP_TYPES = [1, 3, 4]

// VIEW_CHANNEL permission bit (1 << 10). Discord uses BigInt in newer builds.
const VIEW_CHANNEL_BIGINT = 1n << 10n
const VIEW_CHANNEL_NUMBER = 1 << 10

export function isViewChannel(permId: unknown) {
	return permId === VIEW_CHANNEL_BIGINT || permId === VIEW_CHANNEL_NUMBER
}

// Set by index.tsx once the permissions module is found.
export const state: { Permissions?: { can(...args: any[]): boolean } } = {}

export function getChannel(id: string) {
	return (Stores as any).ChannelStore?.getChannel?.(id)
}

export function isHidden(channel: any): boolean {
	if (!channel || !state.Permissions) return false
	if (typeof channel === 'string') channel = getChannel(channel)
	if (!channel || SKIP_TYPES.includes(channel.type)) return false

	// Tells our own `can` patch to return the real answer.
	channel.realCheck = true
	try {
		const viewable = state.Permissions.can(VIEW_CHANNEL_BIGINT, channel)
		return !viewable
	} finally {
		delete channel.realCheck
	}
}

const DISCORD_EPOCH = 1420070400000n

export function snowflakeToDate(id: string) {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH))
}

const UNITS: [string, number][] = [
	['year', 31536000000],
	['month', 2592000000],
	['day', 86400000],
	['hour', 3600000],
	['minute', 60000],
]

export function fromNow(date: Date) {
	const diff = Date.now() - date.getTime()
	const abs = Math.abs(diff)

	for (const [name, ms] of UNITS) {
		if (abs >= ms) {
			const n = Math.floor(abs / ms)
			const text = `${n} ${name}${n > 1 ? 's' : ''}`
			return diff < 0 ? `in ${text}` : `${text} ago`
		}
	}

	return 'just now'
}

/** Converts whatever the patcher hands us into a real array, without needing an iterator. */
export function toArray(args: unknown): any[] {
	if (Array.isArray(args)) return args
	if (args && typeof (args as ArrayLike<unknown>).length === 'number')
		return Array.from(args as ArrayLike<any>)
	return []
}