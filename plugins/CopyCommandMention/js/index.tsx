import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@revenge-mod/discord/actions'
import { Design } from '@revenge-mod/discord/design'
import { Clipboard } from '@revenge-mod/externals/react-native-clipboard'
import { after, before } from '@revenge-mod/patcher'
import { lookupGeneratedIconComponent } from '@revenge-mod/utils/discord'
import { useEffect } from 'react'
import { findInTree } from './tree'

const SHEET_TAG_PREFIX = 'ExecutedCommandPopout'

interface CommandData {
	id: string
	name: string
}

function copy(text: string, message: string) {
	Clipboard.setString(text)

	ToastActionCreators.open({
		key: 'copy-command-mention',
		content: message,
		IconComponent: lookupGeneratedIconComponent(
			'CopyIcon',
			'CopyIcon-secondary',
			'CopyIcon-primary',
		),
	})
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			// Discord opens the popout through ActionSheetActionCreators.openLazy(promise, tag).
			// Only popouts tagged `ExecutedCommandPopout*` are of interest.
			before(ActionSheetActionCreators, 'openLazy', args => {
				const [lazySheet, tag] = args as [
					Promise<{ default: (...a: any[]) => any }>,
					unknown,
				]

				if (typeof tag !== 'string' || !tag.startsWith(SHEET_TAG_PREFIX))
					return args

				// Patch the sheet component as soon as its module resolves,
				// which happens before Discord's own `.then` renders it.
				lazySheet.then(instance => {
					const unpatchSheet = after(instance, 'default', (_, sheet) => {
						// Unpatch once this sheet unmounts, so the patch doesn't pile up.
						useEffect(() => unpatchSheet, [])

						const container = findInTree(
							sheet,
							n => n?.type?.name === 'CommandActionsContainer',
						)
						if (!container) return sheet

						const unpatchContainer = after(
							container,
							'type',
							(containerArgs, containerComp) => {
								useEffect(() => unpatchContainer, [])

								const command = (
									containerArgs as [{ data?: CommandData }?]
								)?.[0]?.data
								if (!command) return containerComp

								// The rows are an array whose first element wraps a TableRow.
								const rows = findInTree<any[]>(
									containerComp,
									n =>
										Array.isArray(n) &&
										n[0]?.props?.children?.type?.name === 'TableRow',
								)
								if (!rows) return containerComp

								const { ActionSheetRow } = Design

								rows.unshift(
									<ActionSheetRow
										key="copy-command-mention"
										label="Copy Command Mention"
										onPress={() =>
											copy(
												`</${command.name}:${command.id}>`,
												'Copied command mention to clipboard',
											)
										}
									/>,
									<ActionSheetRow
										key="copy-command-id"
										label="Copy Command ID"
										onPress={() =>
											copy(command.id, 'Copied command ID to clipboard')
										}
									/>,
								)

								return containerComp
							},
						)

						return sheet
					})
				})

				return args
			}),
		)
	},
})
