// debug.ts
import { Graphics, type Application } from 'pixi.js';

const MAX_SHOTS = 50;
const THUMB_WIDTH = 400;
const MARKER_RADIUS = 6;

interface Prediction {
  x: number;
  y: number;
  width: number;
  height: number;
  score: string;
  label: string;
}

interface Point {
  x: number;
  y: number;
}

interface Delays {
  captureMs: number;
  toWorkerMs: number;
  inferenceMs: number;
  toMainMs: number;
  dispatchMs: number;
  predictToShotMs: number;
  totalMs: number;
}

interface ShotTiming {
  sentAt: number;
  capturedAt: number;
  startedAt: number;
  predictedAt: number;
  receivedAt: number;
  shotAt: number;
}

interface Shot {
  id: number;
  time: number;
  prediction: Prediction;
  click: Point;
  toast: Point | null;
  hits: number;
  delays: Delays;
  image: string;
}

interface ShotRecord {
  prediction: Prediction;
  click: Point;
  toastsShotBefore: number;
  toast: Point | null;
  timing: ShotTiming;
}

declare global {
  interface Window {
    toastHuntShots: Shot[];
    downloadToastHuntShots: () => void;
    toastHuntDelays: () => void;
  }
}

export function buildShotDebugger(app: Application) {
  const overlay = new Graphics();
  overlay.eventMode = 'none';
  overlay.zIndex = 1001;
  app.stage.addChild(overlay);

  const shots: Shot[] = [];
  let shotId = 0;

  function drawPrediction(prediction: Pick<Prediction, 'x' | 'y' | 'width' | 'height'>, click: Point) {
      const { x, y, width, height } = prediction;
      overlay.visible = true;

      overlay
          .clear()
          .rect(x - width / 2, y - height / 2, width, height)
          .stroke({ width: 2, color: 0xff0000 })
          .circle(click.x, click.y, MARKER_RADIUS)
          .stroke({ width: 1, color: 0xffff00 })
          .rect(click.x - 2, click.y - 2, 4, 4)
          .fill(0xff0000);
  }

  function takeScreenshot() {
      // The debug box covers the toasts, so keep it out of the capture.
      const wasVisible = overlay.visible;
      overlay.visible = false;

      const canvas = app.renderer.extract.canvas({
          target: app.stage,
          frame: app.screen,
          resolution: 1,
      }) as HTMLCanvasElement;

      overlay.visible = wasVisible;
      return canvas.toDataURL('image/png');
  }

  function computeDelays(t: ShotTiming): Delays {
      const round = (ms: number) => Math.round(ms * 10) / 10;
      return {
          captureMs: round(t.sentAt - t.capturedAt),
          toWorkerMs: round(t.startedAt - t.sentAt),
          inferenceMs: round(t.predictedAt - t.startedAt),
          toMainMs: round(t.receivedAt - t.predictedAt),
          dispatchMs: round(t.shotAt - t.receivedAt),
          predictToShotMs: round(t.shotAt - t.predictedAt),
          totalMs: round(t.shotAt - t.capturedAt),
      };
  }

  function logShot(shot: Shot) {
      const { prediction, toast, hits, click, delays } = shot;
      const thumbHeight = Math.round(THUMB_WIDTH * app.screen.height / app.screen.width);

      console.groupCollapsed(
          `📸 shot #${shot.id} ${hits > 0 ? '✅ HIT' : '❌ MISS'} at (${prediction.x.toFixed(1)}, ${prediction.y.toFixed(1)})` +
          ` ⏱️ predict→shot ${delays.predictToShotMs}ms, frame→shot ${delays.totalMs}ms`
      );
      console.table(delays);
      console.log('prediction (stage coords):', prediction);
      console.log('click (global coords):', click);
      console.log('nearest live toast:', toast ?? 'none');
      console.log(
          '%c ',
          `padding: ${thumbHeight / 2}px ${THUMB_WIDTH / 2}px; background: url(${shot.image}) no-repeat center / contain;`
      );
      console.groupEnd();
  }

  function recordShot({ prediction, click, toastsShotBefore, toast, timing }: ShotRecord) {
      const shot: Shot = {
          id: ++shotId,
          time: Date.now(),
          prediction,
          click: { x: click.x, y: click.y },
          toast,
          hits: toastsShotBefore,
          delays: computeDelays(timing),
          image: takeScreenshot(),
      };

      shots.push(shot);
      if (shots.length > MAX_SHOTS) shots.shift();

      logShot(shot);
      return shot;
  }

  function downloadShots() {
      for (const shot of shots) {
          const link = document.createElement('a');
          link.href = shot.image;
          link.download = `shot-${String(shot.id).padStart(4, '0')}-${shot.hits > 0 ? 'hit' : 'miss'}.png`;
          link.click();
      }
  }

  function printAverageDelays() {
      if (!shots.length) {
          console.log('No shots recorded yet');
          return;
      }

      const keys = Object.keys(shots[0].delays) as (keyof Delays)[];
      const summary = {} as Record<keyof Delays, { avg: number; min: number; max: number }>;
      for (const key of keys) {
          const values = shots.map((shot) => shot.delays[key]);
          summary[key] = {
              avg: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length * 10) / 10,
              min: Math.min(...values),
              max: Math.max(...values),
          };
      }
      console.log(`⏱️ delays over the last ${shots.length} shots`);
      console.table(summary);
  }

  window.toastHuntShots = shots;
  window.downloadToastHuntShots = downloadShots;
  window.toastHuntDelays = printAverageDelays;

  return {
      overlay,
      drawPrediction,
      recordShot,
  };
}
