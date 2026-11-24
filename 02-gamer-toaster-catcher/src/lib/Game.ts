import {
	Application,
	Assets,
	CanvasTextMetrics,
	Container,
	Graphics,
	Sprite,
	Text,
	type FederatedPointerEvent,
	type Texture,
} from 'pixi.js'
import {main} from '../../machine-learning/main'
import {getSettings, subscribeSettings} from './settings'
import backgroundUrl from '../assets/sprites/background.svg'
import toastBodyUrl from '../assets/sprites/toast-body.svg'
import toastEyesUrl from '../assets/sprites/toast-eyes.svg'
import toastWingsUrl from '../assets/sprites/toast-wings.svg'

const GAME_WIDTH = 450
const GAME_HEIGHT = 680

const INITIAL_LIVES = 5
const INITIAL_SPAWN_INTERVAL = 2000
const MIN_SPAWN_INTERVAL = 500
const TOAST_START_Y = 680
const TOAST_DURATION = 3000
const TOAST_UPWARD_SPEED = -8
const TOAST_EXIT_Y = -50
/** A shot toast starts here, then fades out as it climbs off the screen. */
const SHOT_ALPHA = 0.4

const WINGS_FLAP_PERIOD = 400
const WINGS_PIVOT = {x: 47.5, y: 48.45}
const EYES_BLINK_PERIOD = 2000
const EYES_PIVOT = {x: 15, y: 28.5}

const FONT_FAMILY = 'system-ui'
const STATS_FONT_FAMILY = 'ui-monospace, Consolas, monospace'
const STATS_BOX = {x: 262, y: 637, width: 178, height: 38, radius: 8}

interface GameTextures {
	background: Texture
	toastBody: Texture
	toastWings: Texture
	toastEyes: Texture
}

interface GameElements {
	app: Application
	textures: GameTextures
	toastLayer: Container
	score: Text
	lives: Text
	stats: Text
	finalScoreInfo: Text
	gameOverScreen: Container
}

type Shooter = 'ai' | 'human'

interface ShotStats {
	shots: number
	hits: number
}

interface Toast {
	view: Container
	wings: Sprite
	eyes: Sprite
	startX: number
	endX: number
	startY: number
	peakY: number
	startTime: number
	duration: number
	clicked: boolean
	upwardSpeed: number
	/** Stage `y` at the moment the toast was shot. `0` until then. */
	shotY: number
}

interface GameState {
	toasts: Toast[]
	score: number
	remainingLives: number
	gameOver: boolean
	gameStartTime: number
	spawnTimer: ReturnType<typeof setTimeout> | undefined
	stats: Record<Shooter, ShotStats>
}

function formatScore(score: number): string {
	return score.toString().padStart(8, '0')
}

function getSpawnInterval(gameStartTime: number): number {
	const gameTimeSeconds = (performance.now() - gameStartTime) / 1000
	return Math.max(MIN_SPAWN_INTERVAL, INITIAL_SPAWN_INTERVAL - Math.floor(gameTimeSeconds / 10) * 100)
}

function updateScore(state: GameState, elements: GameElements): void {
	elements.score.text = formatScore(state.score)
}

function updateLives(state: GameState, elements: GameElements): void {
	elements.lives.text = `${state.remainingLives}X`
}

function formatStatsLine(label: string, {shots, hits}: ShotStats): string {
	const ratio = `${hits}/${shots}`
	const percent = shots > 0 ? `${Math.round((hits / shots) * 100)}%` : '--%'
	return `${label.padEnd(4)}${ratio.padStart(8)}${percent.padStart(5)}`
}

function updateStats(state: GameState, elements: GameElements): void {
	elements.stats.text = [formatStatsLine('AI', state.stats.ai), formatStatsLine('YOU', state.stats.human)].join('\n')
}

/**
 * The AI shoots by dispatching synthetic (untrusted) pointer events, so `isTrusted` tells the shooters apart.
 * Returns `null` when the shooter is not the one enabled by `enableAiShot`.
 */
function getShooter(event: FederatedPointerEvent): Shooter | null {
	const shooter: Shooter = event.isTrusted ? 'human' : 'ai'
	const aiEnabled = getSettings().enableAiShot
	return (shooter === 'ai') === aiEnabled ? shooter : null
}

function toastCursor(): string {
	return getSettings().enableAiShot ? 'default' : 'pointer'
}

/** Positions a text so that `baselineY` matches the SVG `<text y>` baseline. */
function placeOnBaseline(text: Text, x: number, baselineY: number, strokeWidth = 0): void {
	const {ascent} = CanvasTextMetrics.measureText(text.text, text.style).fontProperties
	text.position.set(x, baselineY - ascent - strokeWidth / 2)
}

function createToastView(textures: GameTextures): Pick<Toast, 'view' | 'wings' | 'eyes'> {
	const view = new Container()

	const wings = new Sprite(textures.toastWings)
	wings.pivot.set(WINGS_PIVOT.x, WINGS_PIVOT.y)
	wings.position.set(WINGS_PIVOT.x, WINGS_PIVOT.y)

	const body = new Sprite(textures.toastBody)

	const eyes = new Sprite(textures.toastEyes)
	eyes.pivot.set(EYES_PIVOT.x, EYES_PIVOT.y)
	eyes.position.set(EYES_PIVOT.x, EYES_PIVOT.y)

	view.label = 'toast'
	view.addChild(wings, body, eyes)
	return {view, wings, eyes}
}

function spawnToast(state: GameState, elements: GameElements): void {
	if (state.gameOver) return

	const startX = Math.random() * 350 + 25
	const endX = Math.random() * 350 + 25
	const peakY = 200 + Math.random() * 50

	const {view, wings, eyes} = createToastView(elements.textures)
	view.position.set(startX, TOAST_START_Y)
	view.eventMode = 'static'
	view.cursor = toastCursor()
	elements.toastLayer.addChild(view)

	const toast: Toast = {
		view,
		wings,
		eyes,
		startX,
		endX,
		startY: TOAST_START_Y,
		peakY,
		startTime: performance.now(),
		duration: TOAST_DURATION,
		clicked: false,
		upwardSpeed: TOAST_UPWARD_SPEED,
		shotY: 0,
	}

	view.on('pointerdown', (event: FederatedPointerEvent) => {
		if (state.gameOver || toast.clicked) return
		const shooter = getShooter(event)
		if (!shooter) return
		state.stats[shooter].hits += 1
		updateStats(state, elements)
		state.score += 1
		updateScore(state, elements)
		toast.clicked = true
		toast.shotY = view.y
		view.alpha = SHOT_ALPHA
		view.label = 'toast-caught'
	})

	state.toasts.push(toast)
}

function scheduleNextSpawn(state: GameState, elements: GameElements): void {
	state.spawnTimer = setTimeout(() => {
		if (state.gameOver) return
		spawnToast(state, elements)
		scheduleNextSpawn(state, elements)
	}, getSpawnInterval(state.gameStartTime))
}

function checkGameOver(state: GameState, elements: GameElements, onGameOver: () => void): void {
	if (state.gameOver || state.remainingLives > 0) return

	state.gameOver = true
	clearTimeout(state.spawnTimer)

	elements.gameOverScreen.visible = true
	elements.finalScoreInfo.text = `Final Score: ${state.score}`
	onGameOver()
}

/** Returns false when the toast should be removed from the game. */
function updateToast(
	state: GameState,
	elements: GameElements,
	toast: Toast,
	timestamp: number,
	onGameOver: () => void,
): boolean {
	if (toast.clicked) {
		const newY = toast.view.y + toast.upwardSpeed
		toast.view.y = newY
		toast.view.eventMode = 'none'
		const span = toast.shotY - TOAST_EXIT_Y
		const climb = span > 0 ? Math.max(0, (newY - TOAST_EXIT_Y) / span) : 0
		toast.view.alpha = SHOT_ALPHA * climb
		if (newY < TOAST_EXIT_Y) {
			toast.view.destroy({children: true})
			return false
		}
		return true
	}

	const t = (timestamp - toast.startTime) / toast.duration

	if (t > 1) {
		state.remainingLives--
		updateLives(state, elements)
		checkGameOver(state, elements, onGameOver)
		toast.view.destroy({children: true})
		return false
	}

	const x = toast.startX + (toast.endX - toast.startX) * t
	const y = toast.startY - 4 * t * (1 - t) * (toast.startY - toast.peakY)

	toast.view.position.set(x, y)
	return true
}

function animateToast(toast: Toast, timestamp: number): void {
	const elapsed = timestamp - toast.startTime

	const flap = (elapsed % WINGS_FLAP_PERIOD) / WINGS_FLAP_PERIOD
	toast.wings.scale.y = 1 - 0.2 * (1 - Math.abs(1 - 2 * flap))

	const blink = (elapsed % EYES_BLINK_PERIOD) / EYES_BLINK_PERIOD
	toast.eyes.scale.y = blink < 0.9 ? 1 : 1 - (blink - 0.9) / 0.1
}

async function loadTextures(): Promise<GameTextures> {
	const [background, toastBody, toastWings, toastEyes] = await Promise.all(
		[backgroundUrl, toastBodyUrl, toastWingsUrl, toastEyesUrl].map((url) => Assets.load<Texture>(url)),
	)
	return {background, toastBody, toastWings, toastEyes}
}

function buildScene(app: Application, textures: GameTextures): GameElements {
	app.stage.addChild(new Sprite(textures.background))

	const hudStyle = {fontFamily: FONT_FAMILY, fontSize: 27, fontWeight: '900', fill: '#FEDAA1'} as const
	const score = new Text({text: formatScore(0), style: hudStyle})
	const lives = new Text({text: `${INITIAL_LIVES}X`, style: hudStyle})
	placeOnBaseline(score, 25, 46)
	placeOnBaseline(lives, 345, 46)
	app.stage.addChild(score, lives)

	const statsBox = new Graphics()
		.roundRect(STATS_BOX.x, STATS_BOX.y, STATS_BOX.width, STATS_BOX.height, STATS_BOX.radius)
		.fill('#FFE2B4')
		.stroke({width: 2, color: '#67442B'})
	const noShots: ShotStats = {shots: 0, hits: 0}
	const stats = new Text({
		text: [formatStatsLine('AI', noShots), formatStatsLine('YOU', noShots)].join('\n'),
		anchor: {x: 0.5, y: 0.5},
		style: {fontFamily: STATS_FONT_FAMILY, fontSize: 14, fontWeight: '700', fill: '#67442B', lineHeight: 16},
	})
	stats.position.set(STATS_BOX.x + STATS_BOX.width / 2, STATS_BOX.y + STATS_BOX.height / 2)
	app.stage.addChild(statsBox, stats)

	const gameOverScreen = new Container()
	gameOverScreen.eventMode = 'none'
	gameOverScreen.visible = false

	const gameOverStroke = 10
	const gameOverText = new Text({
		text: 'GAME OVER',
		anchor: {x: 0.5, y: 0},
		style: {
			fontFamily: FONT_FAMILY,
			fontSize: 36,
			fontWeight: '900',
			fill: '#f16f33',
			stroke: {color: '#603719', width: gameOverStroke, join: 'round'},
		},
	})
	placeOnBaseline(gameOverText, 225, 220, gameOverStroke)

	const finalScoreInfo = new Text({
		text: 'Final Score: 0',
		anchor: {x: 0.5, y: 0},
		style: {fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: '900', fill: '#fff'},
	})
	placeOnBaseline(finalScoreInfo, 225, 260)

	const restartHint = new Text({
		text: 'Click to play again',
		anchor: {x: 0.5, y: 0},
		style: {fontFamily: FONT_FAMILY, fontSize: 18, fontWeight: '700', fill: '#67442B'},
	})
	placeOnBaseline(restartHint, 225, 295)

	gameOverScreen.addChild(gameOverText, finalScoreInfo, restartHint)
	app.stage.addChild(gameOverScreen)

	const toastLayer = new Container()
	app.stage.addChild(toastLayer)

	return {app, textures, toastLayer, score, lives, stats, finalScoreInfo, gameOverScreen}
}

/**
 * Runs the game loop on an initialized app and returns a function that stops it.
 * After game over, a human click calls `onRestart`.
 */
function runGame(elements: GameElements, onGameOver: () => void, onRestart: () => void): () => void {
	const state: GameState = {
		toasts: [],
		score: 0,
		remainingLives: INITIAL_LIVES,
		gameOver: false,
		gameStartTime: performance.now(),
		spawnTimer: undefined,
		stats: {ai: {shots: 0, hits: 0}, human: {shots: 0, hits: 0}},
	}

	const {stage} = elements.app

	const handleGameOver = (): void => {
		stage.cursor = 'pointer'
		onGameOver()
	}

	const loop = (): void => {
		const timestamp = performance.now()
		if (!state.gameOver) {
			state.toasts = state.toasts.filter((toast) => updateToast(state, elements, toast, timestamp, handleGameOver))
			// Toasts are drawn above the game over screen, so clear them once the game ends.
			if (state.gameOver) clearToasts(state)
		}
		state.toasts.forEach((toast) => animateToast(toast, timestamp))
	}

	/** Toast hits are counted by the toast itself; every allowed click on the stage counts as a shot. */
	const onStagePointerDown = (event: FederatedPointerEvent): void => {
		if (state.gameOver) {
			// Only a human restarts; a late synthetic AI click must not.
			if (event.isTrusted) onRestart()
			return
		}
		const shooter = getShooter(event)
		if (!shooter) return
		state.stats[shooter].shots += 1
		updateStats(state, elements)
	}

	stage.eventMode = 'static'
	stage.hitArea = elements.app.screen
	stage.cursor = 'default'
	stage.on('pointerdown', onStagePointerDown)

	const unsubscribe = subscribeSettings(() => {
		const cursor = toastCursor()
		state.toasts.forEach((toast) => {
			toast.view.cursor = cursor
		})
	})

	elements.gameOverScreen.visible = false
	updateScore(state, elements)
	updateLives(state, elements)
	updateStats(state, elements)
	spawnToast(state, elements)
	scheduleNextSpawn(state, elements)
	elements.app.ticker.add(loop)

	return () => {
		state.gameOver = true
		clearTimeout(state.spawnTimer)
		elements.app.ticker.remove(loop)
		stage.off('pointerdown', onStagePointerDown)
		unsubscribe()
		clearToasts(state)
	}
}

function clearToasts(state: GameState): void {
	state.toasts.forEach((toast) => toast.view.destroy({children: true}))
	state.toasts = []
}

function showLoadingScreen(app: Application): Text {
	const loadingText = new Text({
		text: 'Loading AI model...',
		anchor: {x: 0.5, y: 0.5},
		style: {fontFamily: FONT_FAMILY, fontSize: 24, fontWeight: '900', fill: '#fff'},
	})
	loadingText.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2)
	app.stage.addChild(loadingText)
	return loadingText
}

/**
 * Mounts the game canvas into `host`, waits for the AI model to load, then starts the game.
 * Returns a function that stops the game and removes the canvas.
 */
export function startGame(host: HTMLElement): () => void {
	const app = new Application()
	let disposed = false
	let initialized = false
	let stopModel: (() => void) | undefined
	let stopGame: (() => void) | undefined

	const init = async (): Promise<void> => {
		await app.init({
			width: GAME_WIDTH,
			height: GAME_HEIGHT,
			resolution: 1,
			background: '#7DC8CF',
			antialias: true,
		})
		if (disposed) {
			app.destroy(true, {children: true})
			return
		}

		const textures = await loadTextures()
		if (disposed) {
			app.destroy(true, {children: true})
			return
		}

		host.appendChild(app.canvas)
		const elements = buildScene(app, textures)
		const loadingText = showLoadingScreen(app)
		initialized = true

		const model = main(app)
		stopModel = model.stop
		await model.ready
		if (disposed) return

		loadingText.destroy()
		const startRound = (): void => {
			stopGame?.()
			model.resume()
			stopGame = runGame(elements, model.pause, startRound)
		}
		startRound()
	}

	void init().catch((err) => {
		console.error(err)
	})

	return () => {
		disposed = true
		stopGame?.()
		stopModel?.()
		if (initialized) {
			app.destroy(true, {children: true})
		}
	}
}
