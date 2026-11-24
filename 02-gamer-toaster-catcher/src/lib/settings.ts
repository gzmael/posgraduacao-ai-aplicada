export interface GameSettings {
	/** Minimum model confidence (0..1) for a detection to count. */
	classThreshold: number
	enableDebug: boolean
	enableBoxes: boolean
	/** Milliseconds between frames sent to the model. */
	captureInterval: number
	enableAiShot: boolean
}

type SettingsListener = (settings: GameSettings, previous: GameSettings) => void

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
	classThreshold: 0.5,
	enableDebug: true,
	enableBoxes: true,
	captureInterval: 200,
	enableAiShot: true,
})

let current: GameSettings = {...DEFAULT_SETTINGS}
const listeners = new Set<SettingsListener>()

export function getSettings(): GameSettings {
	return current
}

export function applySettings(next: GameSettings): void {
	const previous = current
	current = {...next}
	listeners.forEach((listener) => listener(current, previous))
}

export function resetSettings(): GameSettings {
	applySettings(DEFAULT_SETTINGS)
	return current
}

export function subscribeSettings(listener: SettingsListener): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function sameSettings(a: GameSettings, b: GameSettings): boolean {
	return (Object.keys(a) as (keyof GameSettings)[]).every((key) => a[key] === b[key])
}
