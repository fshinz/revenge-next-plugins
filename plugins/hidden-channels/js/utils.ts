import { AlertActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { getModules } from '@revenge-mod/modules/finders'
import { withName, withProps } from '@revenge-mod/modules/finders/filters'
import { after, instead } from '@revenge-mod/patcher'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { Fragment } from 'react'
import AlertContent from './AlertContent'
import SettingsPage from './Settings'
import {
	DEFAULT_SETTINGS,
	getChannel,
	isHidden,
	isViewChannel,
	type Settings,
	state,
	toArray,
} from './utils'

// Only these navigation functions are patched ('forward' is the one Discord actually uses).
const ROUTER_KEYS = ['transitionToGuild', 'forward']

function confirmOpen(channel: any, proceed: () => void) {
	const { AlertModal, AlertActionButton } = Design

	AlertActionCreators.openAlert(
		'hidden-channels-alert',
		<AlertModal
			title="This channel is hidden."
			content={<AlertContent channel={channel} />}
			actions={
				<>
					<AlertActionButton text="View Anyway" onPress={proceed} />
					<AlertActionButton text="Cancel" variant="secondary" />
				</>
			}
		/>,
	)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: {
		load: true,
		default: DEFAULT_SETTINGS,
	},

	SettingsComponent: SettingsPage,

	start({ cleanup, jsonStorage, logger }) {
		const settings = () => ({ ...DEFAULT_SETTINGS, ...jsonStorage.cache })

		// Log each kind of problem only once, so a hot code path can't flood the logs.
		const reported = new Set<string>()
		const reportOnce = (where: string, e: unknown) => {
			if (reported.has(where)) return
			reported.add(where)
			logger.error(`[${where}] ${String(e)}`)
		}

		cleanup(() => {
			state.Permissions = undefined
		})

		// 1. Make Discord think we can view every channel (unless we ask for the real answer).
		cleanup(
			getModules(
				withProps<{ can: (...a: any[]) => boolean }>(
					'getChannelPermissions',
					'can',
				),
				Permissions => {
					state.Permissions = Permissions

					cleanup(
						after(Permissions, 'can', (rawArgs: any, ret: any) => {
							try {
								if (!Array.isArray(rawArgs))
									reportOnce(
										'can-args-shape',
										Object.prototype.toString.call(rawArgs),
									)

								const args = toArray(rawArgs)
								const channel = args[1]

								if (!channel?.realCheck && isViewChannel(args[0])) return true
							} catch (e) {
								reportOnce('can', e)
							}

							return ret
						}),
					)
				},
			),
		)

		// 2. Show the info popup when navigating to a hidden channel.
		cleanup(
			getModules(withProps<Record<string, any>>('transitionToGuild'), Router => {
				for (const key of ROUTER_KEYS) {
					if (typeof Router[key] !== 'function') continue

					cleanup(
						instead(Router, key, (rawArgs: any, original: any) => {
							const args = toArray(rawArgs)

							try {
								if (typeof args[0] === 'string') {
									const channelId = args[0].match(/(\d+)$/)?.[1]
									const channel = channelId && getChannel(channelId)

									if (channel && isHidden(channel) && settings().showPopup) {
										confirmOpen(channel, () => original(...args))
										return {}
									}
								}
							} catch (e) {
								reportOnce(`router-${key}`, e)
							}

							return original(...args)
						}),
					)
				}
			}),
		)

		// 3. Lock icon next to hidden channel names.
		cleanup(
			getModules(
				withName<{ default: (props: any) => any }>('ChannelInfo'),
				ChannelInfo => {
					if (typeof ChannelInfo?.default !== 'function') {
						logger.warn('ChannelInfo has no default export to patch')
						return
					}

					const LockIcon = lookupGeneratedIconComponent(
						'LockIcon',
						'LockIcon-secondary',
						'LockIcon-primary',
					)

					cleanup(
						after(ChannelInfo, 'default', (rawArgs: any, ret: any) => {
							try {
								const channel = toArray(rawArgs)[0]?.channel
								if (!settings().showIcon || !channel || !isHidden(channel))
									return ret

								return (
									<Fragment>
										{LockIcon ? <LockIcon size="sm" /> : null}
										{ret}
									</Fragment>
								)
							} catch (e) {
								reportOnce('channel-info', e)
								return ret
							}
						}),
					)
				},
				{ returnNamespace: true },
			),
		)
	},
})