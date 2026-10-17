/**
 * Minimal React element tree walker.
 *
 * Walks arrays, and the `props` of anything that looks like a React element,
 * depth first, and returns the first node the predicate accepts.
 * This is the equivalent of Vendetta's `findInReactTree`.
 */
export function findInTree<T = any>(
	root: unknown,
	predicate: (node: any) => boolean,
	maxDepth = 24,
): T | undefined {
	const seen = new Set<unknown>()

	const walk = (node: unknown, depth: number): T | undefined => {
		if (!node || typeof node !== 'object' || depth > maxDepth) return
		if (seen.has(node)) return
		seen.add(node)

		if (predicate(node)) return node as T

		if (Array.isArray(node)) {
			for (const child of node) {
				const found = walk(child, depth + 1)
				if (found !== undefined) return found
			}
			return
		}

		const props = (node as { props?: unknown }).props
		if (props && typeof props === 'object') {
			for (const key of ['children', 'sheet', 'content'] as const) {
				const found = walk(
					(props as Record<string, unknown>)[key],
					depth + 1,
				)
				if (found !== undefined) return found
			}
		}
	}

	return walk(root, 0)
}
