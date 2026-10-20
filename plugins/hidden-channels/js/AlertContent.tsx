import { ToastActionCreators } from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { Clipboard } from '@revenge-mod/externals/react-native-clipboard'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { fromNow, snowflakeToDate } from './utils'

function toast(content: string, icon: string) {
	ToastActionCreators.open({
		key: 'hidden-channels-toast',
		content,
		IconComponent: lookupGeneratedIconComponent(
			icon,
			`${icon}-secondary`,
			`${icon}-primary`,
		),
	})
}

function FancyDate({ date }: { date: Date }) {
	const { Text } = Design

	return (
		<Text
			variant="text-md/medium"
			color="text-link"
			onPress={() => toast(date.toLocaleString(), 'ClockIcon')}
			onLongPress={() => {
				Clipboard.setString(date.getTime().toString())
				toast('Copied timestamp to clipboard', 'CopyIcon')
			}}
		>
			{fromNow(date)}
		</Text>
	)
}

export default function AlertContent({ channel }: { channel: any }) {
	const { Text } = Design

	return (
		<Text variant="text-md/normal">
			<Text variant="text-md/semibold">Topic: </Text>
			{channel.topic || 'No topic.'}
			{'\n\n'}
			<Text variant="text-md/semibold">Creation date: </Text>
			<FancyDate date={snowflakeToDate(channel.id)} />
			{'\n\n'}
			<Text variant="text-md/semibold">Last message: </Text>
			{channel.lastMessageId ? (
				<FancyDate date={snowflakeToDate(channel.lastMessageId)} />
			) : (
				'No messages.'
			)}
			{'\n\n'}
			<Text variant="text-md/semibold">Last pin: </Text>
			{channel.lastPinTimestamp ? (
				<FancyDate date={new Date(channel.lastPinTimestamp)} />
			) : (
				'No pins.'
			)}
		</Text>
	)
}