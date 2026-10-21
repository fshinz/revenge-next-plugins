import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { getModules } from '@revenge-mod/modules/finders'
import { withProps } from '@revenge-mod/modules/finders/filters'
import { instead } from '@revenge-mod/patcher'
import AlertContent from './AlertContent'
import {
	getChannel,
	isHidden,
	isViewChannel,
	reconnectGateway,
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

interface Storage {
	cacheCleared: boolean
}

export default plugin<{ jsonStorage: Storage }>({
	jsonStorage: {
		load: true,
		default: { cacheCleared: false },
	},

	start({ cleanup, jsonStorage }) {
		cleanup(() => {
			state.Permissions = undefined
		})

		// 0. Turn off Discord's private channel hiding experiment so the server sends real names
		cleanup(
			getModules(
				withProps<{ overrideBucket: (...a: any[]) => void }>('overrideBucket'),
				Experiments => {
					Experiments.overrideBucket('apex', '2026-02-private-channel-hiding', 0)
					if (!jsonStorage.cache.cacheCleared && reconnectGateway())
						jsonStorage.set({ cacheCleared: true })
				},
			),
		)

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

		// 2. Show the info popup when navigating to a hidden channel
		cleanup(
			getModules(withProps<Record<string, any>>('transitionToGuild'), Router => {
				for (const key of Object.keys(Router)) {
					if (typeof Router[key] !== 'function') continue

					cleanup(
						instead(Router, key, (args: any[], original: any) => {
							if (typeof args[0] === 'string') {
								const channelId = args[0].match(/(\d+)$/)?.[1]
								const channel = channelId && getChannel(channelId)

								if (channel && isHidden(channel)) {
									confirmOpen(channel, () => original(...args))
									return {}
								}
							}

							return original(...args)
						}),
					)
				}
			}),
		)
	},
})
