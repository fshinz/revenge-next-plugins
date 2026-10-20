import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { instead } from '@revenge-mod/patcher'
import AlertContent from './AlertContent'
import SettingsPage from './Settings'
import {
	DEFAULT_SETTINGS,
	getChannel,
	isHidden,
	isViewChannel,
	type Settings,
	state,
} from './utils'

const ALERT_KEY = 'hidden-channels-alert'

function confirmOpen(channel: any, proceed: () => void) {
	const { AlertModal, AlertActionButton } = Design

	AlertActionCreators.openAlert(
		ALERT_KEY,
		<AlertModal
			title="This channel is hidden."
			content={<AlertContent channel={channel} />}
			actions={
				<>
					<AlertActionButton
						text="View Anyway"
						variant="primary"
						onPress={() => {
							try {
								AlertActionCreators.dismissAlert(ALERT_KEY)
							} catch {}
							proceed()
						}}
					/>
					<AlertActionButton
						text="Cancel"
						variant="secondary"
						onPress={() => {
							try {
								AlertActionCreators.dismissAlert(ALERT_KEY)
							} catch {}
						}}
					/>
				</>
			}
		/>,
	)
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

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DEFAULT_SETTINGS,
	},

	SettingsComponent: SettingsPage,

	start({ cleanup, jsonStorage }) {
		const settings = () => ({ ...DEFAULT_SETTINGS, ...jsonStorage.cache })

		cleanup(() => {
			state.Permissions = undefined
		})

		// 1. Force Permissions Store to treat hidden channels as viewable
		cleanup(
			onImportedPath('stores/PermissionStore.tsx', (ns: any) => {
				const Permissions = ns?.default ?? ns
				if (!Permissions?.can) return

				state.Permissions = Permissions

				cleanup(
					instead(Permissions, 'can', (args: any[], original: any) => {
						const ret = original(...args)
						try {
							const channel = args?.[1]
							if (!channel?.realCheck && isViewChannel(args?.[0])) return true
						} catch {}
						return ret
					}),
				)
			}),
		)

		// 2. Intercept Channel Selection / Navigation via ChannelSelectActionCreators
		cleanup(
			onImportedPath(
				'actions/ChannelSelectActionCreators.tsx',
				(ns: any) => {
					const owner = ns?.default ?? ns
					if (typeof owner?.selectChannel !== 'function') return

					cleanup(
						instead(owner, 'selectChannel', (args: any[], original: any) => {
							try {
								// args[0] is either channelId or { channelId: "..." }
								const rawId = typeof args?.[0] === 'string' ? args[0] : args?.[0]?.channelId
								const channel = rawId ? getChannel(rawId) : null

								if (channel && isHidden(channel) && settings().showPopup) {
									confirmOpen(channel, () => original(...args))
									return
								}
							} catch {}

							return original(...args)
						}),
					)
				},
			),
		)
	},
})
