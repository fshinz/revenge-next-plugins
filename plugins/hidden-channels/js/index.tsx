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
} from './utils'

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
						after(Permissions, 'can', ([permId, channel], ret) => {
							if (!channel?.realCheck && isViewChannel(permId)) return true
							return ret
						}),
					)
				},
			),
		)

		// 2. Show the info popup when navigating to a hidden channel.
		cleanup(
			getModules(withProps<Record<string, any>>('transitionToGuild'), Router => {
				// Every function is patched because the one actually used (`forward`) isn't obvious.
				for (const key of Object.keys(Router)) {
					if (typeof Router[key] !== 'function') continue

					cleanup(
						instead(Router, key, (args: any[], original: any) => {
							if (typeof args[0] === 'string') {
								const channelId = args[0].match(/(\d+)$/)?.[1]
								const channel = channelId && getChannel(channelId)

								if (channel && isHidden(channel)) {
									if (settings().showPopup) {
										confirmOpen(channel, () => original(...args))
										return {}
									}
								}
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
						after(ChannelInfo, 'default', ([props], ret) => {
							const channel = props?.channel
							if (!settings().showIcon || !channel || !isHidden(channel))
								return ret

							return (
								<Fragment>
									{LockIcon ? <LockIcon size="sm" /> : null}
									{ret}
								</Fragment>
							)
						}),
					)
				},
				{ returnNamespace: true },
			),
		)
	},
})
