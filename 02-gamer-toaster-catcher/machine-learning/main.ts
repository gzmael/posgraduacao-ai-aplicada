import { Graphics, type Application } from "pixi.js";
import { getSettings, subscribeSettings, type GameSettings } from "../src/lib/settings";
import { buildShotDebugger } from "./debug";

const PREDICTION_HOLD_MS = 500;
const AIM_FLASH_MS = 150;
const BOX_COLOR = 0x39ff14;
const AIM_COLOR = 0x111111;
const BOX_STROKE = 4;
const AIM_STROKE = 4;

export interface ModelSession {
    /** Resolves once the worker has loaded the model; frame capture starts at that point. */
    ready: Promise<void>;
    /** Stops sending frames and clears the overlays, keeping the model loaded for `resume`. */
    pause: () => void;
    resume: () => void;
    stop: () => void;
}

interface PredictionBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

// Ducks move too far for predictions from older frames to land a hit.
const MAX_FRAME_AGE_MS = 300;

// Absolute timestamp, comparable with the worker's (performance.now() alone has a per-thread origin)
const now = () => performance.timeOrigin + performance.now();

/** Loads the YOLO worker and, once the model is ready, starts sending game frames to it. */
export function main(app: Application): ModelSession {

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const shotDebugger = buildShotDebugger(app);
    const boxOverlay = createPredictionOverlay(app);
    const aimOverlay = createPredictionOverlay(app);
    const overlays = [boxOverlay, aimOverlay, shotDebugger.overlay];

    let stopCapture: (() => void) | undefined;
    let modelLoaded = false;
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });

    let pending: PredictionBox[] = [];
    let rafId = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let aimTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let paused = false;

    const showPredictions = (predictions: PredictionBox[]): void => {
        drawBoxes(boxOverlay, predictions);
        clearTimeout(hideTimer);
        if (predictions.length === 0) return;
        hideTimer = setTimeout(() => {
            boxOverlay.clear();
            boxOverlay.visible = false;
        }, PREDICTION_HOLD_MS);
    };

    const flashAim = (predictions: PredictionBox[]): void => {
        drawAim(aimOverlay, predictions);
        clearTimeout(aimTimer);
        if (!aimOverlay.visible) return;
        aimTimer = setTimeout(() => {
            aimOverlay.clear();
            aimOverlay.visible = false;
        }, AIM_FLASH_MS);
    };

    const hideOverlay = (overlay: Graphics, timer: ReturnType<typeof setTimeout> | undefined): void => {
        clearTimeout(timer);
        overlay.clear();
        overlay.visible = false;
    };

    /** Frames are only worth capturing while something consumes the predictions. */
    const syncCapture = (settings: GameSettings): void => {
        stopCapture?.();
        stopCapture = undefined;
        if (stopped || paused || !modelLoaded) return;
        if (!settings.enableAiShot && !settings.enableBoxes) return;
        stopCapture = captureLoop(app, worker, overlays, settings.captureInterval);
    };

    const postConfig = (settings: GameSettings): void => {
        worker.postMessage({ type: 'config', classThreshold: settings.classThreshold });
    };

    postConfig(getSettings());

    const unsubscribe = subscribeSettings((settings, previous) => {
        if (stopped) return;
        if (settings.classThreshold !== previous.classThreshold) postConfig(settings);
        if (!settings.enableBoxes) hideOverlay(boxOverlay, hideTimer);
        if (!settings.enableAiShot) hideOverlay(aimOverlay, aimTimer);

        const wasCapturing = previous.enableAiShot || previous.enableBoxes;
        const shouldCapture = settings.enableAiShot || settings.enableBoxes;
        if (settings.captureInterval !== previous.captureInterval || wasCapturing !== shouldCapture) {
            syncCapture(settings);
        }
    });

    worker.onmessage = ({ data }) => {
        if (stopped) return;
        const { type, x, y, width, height, score, label, timing } = data;

        if (type === 'prediction') {
            if (paused) return;
            const { enableAiShot, enableBoxes, enableDebug } = getSettings();
            if (enableDebug) console.log(`🎯 AI predicted at: (${x}, ${y}) ${width}x${height}`);
            const receivedAt = now();

            if (![x, y, width, height].every((value) => typeof value === 'number')) return;

            const frameAgeMs = receivedAt - timing.capturedAt;
            if (frameAgeMs > MAX_FRAME_AGE_MS) {
                if (enableDebug) {
                    console.debug(`⏭️ Skipped stale prediction at: (${x}, ${y}), frame is ${frameAgeMs.toFixed(1)}ms old`);
                }
                return;
            }

            if (enableAiShot) {
                const { toast, toastsShotBefore } = findShotTarget(app, x, y);
                const shotAt = now();
                clickAt(app, x, y);

                if (enableDebug) {
                    const prediction = { x, y, width, height, score: String(score), label: String(label) };
                    // shotDebugger.drawPrediction(prediction, { x, y });
                    shotDebugger.recordShot({
                        prediction,
                        click: { x, y },
                        toastsShotBefore,
                        toast,
                        timing: { ...timing, receivedAt, shotAt },
                    });
                }
            }

            if (!enableAiShot && !enableBoxes) return;

            pending.push({ x, y, width, height });
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (stopped || paused) return;
                const batch = pending;
                pending = [];
                const settings = getSettings();
                if (settings.enableAiShot) flashAim(batch);
                if (settings.enableBoxes) showPredictions(batch);
            });
        }

        if (type === 'model-loaded') {
            console.log(`🤖 Model loaded`);
            modelLoaded = true;
            if (!stopCapture) syncCapture(getSettings());
            resolveReady();
        }

    };

    return {
        ready,
        pause: () => {
            if (stopped || paused) return;
            paused = true;
            stopCapture?.();
            stopCapture = undefined;
            cancelAnimationFrame(rafId);
            rafId = 0;
            pending = [];
            hideOverlay(boxOverlay, hideTimer);
            hideOverlay(aimOverlay, aimTimer);
        },
        resume: () => {
            if (stopped || !paused) return;
            paused = false;
            syncCapture(getSettings());
        },
        stop: () => {
            if (stopped) return;
            stopped = true;
            unsubscribe();
            stopCapture?.();
            clearTimeout(hideTimer);
            clearTimeout(aimTimer);
            cancelAnimationFrame(rafId);
            boxOverlay.destroy();
            aimOverlay.destroy();
            shotDebugger.overlay.destroy();
            worker.terminate();
        },
    };
}

/** Live toasts are labeled `toast` until a click marks them `toast-caught`. */
function findShotTarget(app: Application, x: number, y: number): { toast: { x: number; y: number } | null; toastsShotBefore: number } {
    const toasts = app.stage.getChildrenByLabel('toast', true);
    let toast: { x: number; y: number } | null = null;
    let nearestDist = Infinity;
    let toastsShotBefore = 0;

    for (const target of toasts) {
        const bounds = target.getBounds();
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const dist = (centerX - x) ** 2 + (centerY - y) ** 2;
        if (dist < nearestDist) {
            nearestDist = dist;
            toast = { x: centerX, y: centerY };
        }
        if (bounds.containsPoint(x, y)) toastsShotBefore += 1;
    }

    return { toast, toastsShotBefore };
}

/** Stage coordinates from the worker, mapped back to a canvas pointer event. */
function clickAt(app: Application, x: number, y: number): void {
    const canvas = app.canvas;
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + x * app.renderer.resolution * (rect.width / canvas.width);
    const clientY = rect.top + y * app.renderer.resolution * (rect.height / canvas.height);
    const init: PointerEventInit = {
        clientX,
        clientY,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
        button: 0,
        buttons: 1,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
}

function createPredictionOverlay(app: Application): Graphics {
    const overlay = new Graphics();
    overlay.eventMode = 'none';
    overlay.zIndex = 1000;
    overlay.visible = false;
    app.stage.sortableChildren = true;
    app.stage.addChild(overlay);
    return overlay;
}

function drawBoxes(overlay: Graphics, predictions: PredictionBox[]): void {
    overlay.clear();

    for (const { x, y, width, height } of predictions) {
        if (width <= 0 || height <= 0) continue;

        overlay
            .rect(x - width / 2, y - height / 2, width, height)
            .stroke({ width: BOX_STROKE, color: BOX_COLOR });
    }

    overlay.visible = predictions.some(({ width, height }) => width > 0 && height > 0);
}

/** Crosshair flashed at the click point for the moment the shot is dispatched. */
function drawAim(overlay: Graphics, predictions: PredictionBox[]): void {
    overlay.clear();

    for (const { x, y, width, height } of predictions) {
        if (width <= 0 || height <= 0) continue;

        const radius = Math.min(width, height) * 0.34;
        overlay
            .circle(x, y, radius)
            .moveTo(x - width * 0.46, y)
            .lineTo(x + width * 0.46, y)
            .moveTo(x, y - height * 0.46)
            .lineTo(x, y + height * 0.46)
            .stroke({ width: AIM_STROKE, color: AIM_COLOR, cap: 'butt', join: 'round' });
    }

    overlay.visible = predictions.some(({ width, height }) => width > 0 && height > 0);
}

function captureLoop(app: Application, worker: Worker, overlays: Graphics[], intervalMs: number): () => void {
    let grabbing = false;
    let stopped = false;

    const timer = setInterval(async () => {
        if (grabbing || stopped) return;

        grabbing = true;
        const capturedAt = now();
        const wasVisible = overlays.map((overlay) => overlay.visible);
        for (const overlay of overlays) overlay.visible = false;
        try {
            const canvas = app.renderer.extract.canvas({
                target: app.stage,
                frame: app.screen,
                resolution: 1,
            }) as HTMLCanvasElement;
            overlays.forEach((overlay, index) => {
                overlay.visible = wasVisible[index];
            });
            if (stopped) return;
            const bitmap = await createImageBitmap(canvas);
            if (stopped) {
                bitmap.close();
                return;
            }

            worker.postMessage({
                type: "predict",
                image: bitmap,
                timing: { capturedAt, sentAt: now() },
            }, [bitmap]);
        } catch (err) {
            overlays.forEach((overlay, index) => {
                overlay.visible = wasVisible[index];
            });
            console.error(err);
        } finally {
            grabbing = false;
        }
    }, intervalMs);

    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
