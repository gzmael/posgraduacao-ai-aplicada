# Gamer Toaster Catcher

A browser game where flying toasts are caught by a YOLOv5n model running in TensorFlow.js. The playable scene is a PixiJS port of **Toast Catcher Game**, listed on [FreeFrontend — JavaScript Games (page 2)](https://freefrontend.com/javascript-games/page/2/). The original pen is [Toast Catcher Game](https://codepen.io/Megafry/pen/yyyZyYw) by Megafry.

In the reference game, toasts arc out of a toaster. A click scores a point, a miss costs one of five lives, and new toasts spawn faster as time passes. This project keeps that loop and redraws it with PixiJS so each frame can be captured and sent to the model.

## Frame capture with PixiJS

The original game draws with SVG `<use>` elements. That markup is not a bitmap the model can read. The scene now runs on a PixiJS `Application` (`src/lib/Game.ts`). Once the model is loaded, `machine-learning/main.ts` hides the prediction overlays and copies the stage with `app.renderer.extract.canvas()`. The canvas becomes an `ImageBitmap` and is transferred to a web worker every `CAPTURE_INTERVAL` ms (200 by default).

The worker (`machine-learning/worker.ts`) resizes the frame to 640×640, runs YOLOv5n, and keeps boxes labeled `kite` or `airplane` with confidence above `CLASS_THRESHOLD` (0.5 by default). The main thread turns the box center into a pointer event on the game canvas, which is the same click the player would make.

## Settings panel

The React panel on the right of the game (`src/components/SettingsPanel.tsx`) edits a draft of the runtime settings. **Apply configs** pushes the draft to the shared store in `src/lib/settings.ts`. **Reset** restores the defaults and applies them right away. The game and the ML pipeline subscribe to the store, so changes take effect without reloading.

| Setting | Default | Effect |
| --- | --- | --- |
| `CLASS_THRESHOLD` | 0.5 | Minimum confidence for a detection, sent to the worker |
| `CAPTURE_INTERVAL` | 200 ms | Time between frames sent to the model |
| `ENABLE_AI_SHOT` | on | The AI clicks the detected toasts. When off, the player clicks toasts and AI clicks are ignored |
| `ENABLE_BOXES` | on | Draws the green prediction boxes |
| `ENABLE_DEBUG` | on | Logs predictions and records shots in the shot debugger |

Frame capture pauses while both `ENABLE_AI_SHOT` and `ENABLE_BOXES` are off.

## Accuracy readout

The box in the bottom bar compares the AI with the player. Each line shows hits, shots, and hit rate (for example `AI 12/15 80%`). A shot is any click on the game while that shooter is enabled, and a hit is a click that catches a toast. AI clicks are told apart from human clicks by `isTrusted`, because the AI dispatches synthetic pointer events.

When the game ends, the remaining toasts are removed so the final score is visible, and frame capture pauses with the model still loaded. Clicking the game starts a new round with fresh score, lives, and accuracy stats. Only a human click restarts the game.

## Shot debugger

`buildShotDebugger` in `machine-learning/debug.ts` runs on every AI shot while `ENABLE_DEBUG` is on. Each click records the prediction and prints it in the browser console.

Each shot is logged as a collapsed group:

- shot id, hit or miss, and the predicted stage coordinates
- time from prediction to click, and from the captured frame to the click
- a table of delays: capture, transfer to the worker, inference, return to the main thread, click dispatch, and the two totals
- the prediction box, the click point, and the nearest live toast
- a thumbnail of the frame, taken with the debug overlay hidden

It also attaches helpers on `window`:

| Helper | What it prints or does |
| --- | --- |
| `toastHuntShots` | The last 50 recorded shots |
| `toastHuntDelays()` | Min, average, and max of each delay over those shots |
| `downloadToastHuntShots()` | Downloads each shot as a PNG named `shot-####-hit.png` or `shot-####-miss.png` |

## Packages

Runtime:

- [pixi.js](https://pixijs.com/) — sprites, the game loop, and `renderer.extract.canvas()` for the frame sent to the model
- [@tensorflow/tfjs](https://www.tensorflow.org/js) — loads `public/yolov5n_web_model` and runs inference in the worker
- [react](https://react.dev/) and [react-dom](https://react.dev/) — mount the canvas host and the settings panel in `src/App.tsx`

Tooling:

- [Vite](https://vite.dev/) — dev server and production build
- [TypeScript](https://www.typescriptlang.org/)
- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) with [babel-plugin-react-compiler](https://react.dev/learn/react-compiler)
- [Oxlint](https://oxc.rs/) — `npm run lint`

## Scripts

```bash
npm install
npm run dev      # start the game
npm run build    # typecheck and build
npm run preview  # serve the production build
npm run lint
```
