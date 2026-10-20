import { Page, TableRowAssetIcon } from '@revenge-mod/components'
import { Design } from '@revenge-mod/discord/design'
import type { PluginApi } from '@revenge-mod/plugins/types'
import { DEFAULT_SETTINGS, type Settings } from './utils'

export default function SettingsPage({
	api,
}: {
	api: PluginApi<{ jsonStorage: Settings }>
}) {
	const { TableRowGroup, TableSwitchRow } = Design
	const settings = { ...DEFAULT_SETTINGS, ...api.jsonStorage.use() }

	return (
		<Page>
			<TableRowGroup title="Options">
				<TableSwitchRow
					label="Show Lock Icon"
					subLabel="Show a lock icon next to hidden channel names."
					icon={<TableRowAssetIcon name="LockIcon" />}
					value={settings.showIcon}
					onValueChange={(showIcon: boolean) =>
						api.jsonStorage.set({ showIcon })
					}
				/>
			</TableRowGroup>
		</Page>
	)
}
