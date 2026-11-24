import * as tf from '@tensorflow/tfjs';

const MODEL_PATH = `/yolov5n_web_model/model.json`;
const LABELS_PATH = `/yolov5n_web_model/labels.json`;
const INPUT_MODEL_DIMENTIONS = 640

let classThreshold = 0.5
let _labels: string[] = []
let _model: tf.GraphModel | null = null

async function loadModelAndLabels() {
    await tf.ready()

    _labels = await (await fetch(LABELS_PATH)).json()
    _model = await tf.loadGraphModel(MODEL_PATH)

    // warmup
    const inputShape = _model.inputs[0]?.shape
    if (inputShape) {
        const dummyInput = tf.ones(inputShape)
        await _model.executeAsync(dummyInput)
        tf.dispose(dummyInput)
    }

    postMessage({ type: 'model-loaded' })

}

/**
 * Pré-processa a imagem para o formato aceito pelo YOLO:
 * - tf.browser.fromPixels(): converte ImageBitmap/ImageData para tensor [H, W, 3]
 * - tf.image.resizeBilinear(): redimensiona para [INPUT_DIM, INPUT_DIM]
 * - .div(255): normaliza os valores para [0, 1]
 * - .expandDims(0): adiciona dimensão batch [1, H, W, 3]
 *
 * Uso de tf.tidy():
 * - Garante que tensores temporários serão descartados automaticamente,
 *   evitando vazamento de memória.
 */
function preprocessImage(input: ImageBitmap) {
    return tf.tidy(() => {
        const image = tf.browser.fromPixels(input)

        return tf.image
            .resizeBilinear(image, [INPUT_MODEL_DIMENTIONS, INPUT_MODEL_DIMENTIONS])
            .div(255)
            .expandDims(0)
    })
}

async function runInference(tensor: tf.Tensor<tf.Rank>) {
    if (!_model) return

    const output = await _model.executeAsync(tensor) as tf.Tensor<tf.Rank>[]
    tf.dispose(tensor)
    // Assume que as 3 primeiras saídas são:
    // caixas (boxes), pontuações (scores) e classes

    const [boxes, scores, classes] = output 
    const [boxesData, scoresData, classesData] = await Promise.all(
        [
            boxes.data(),
            scores.data(),
            classes.data(),
        ]
    )

    output.forEach(t => t.dispose())

    return {
        boxes: boxesData,
        scores: scoresData,
        classes: classesData
    }
}

/**
 * Filtra e processa as predições:
 * - Aplica o limiar de confiança (classThreshold, configurável via mensagem 'config')
 * - Filtra apenas a classe desejada (exemplo: 'kite')
 * - Converte coordenadas normalizadas para pixels reais
 * - Calcula o centro do bounding box
 *
 * Uso de generator (function*):
 * - Permite enviar cada predição assim que processada, sem criar lista intermediária
 */

type InferenceType = Float32Array<ArrayBufferLike> | Int32Array<ArrayBufferLike> | Uint8Array<ArrayBufferLike>;

interface Prediction {
    boxes: InferenceType
    scores: InferenceType
    classes: InferenceType
}

interface PredictionResult {
    x: number
    y: number
    width: number
    height: number
    score: string
    label: string
}

function* processPrediction({ boxes, scores, classes }: Prediction, width: number, height: number): Generator<PredictionResult> {
    const acceptedLabels = ['kite', 'airplane'];

    for (let index = 0; index < scores.length; index++) {
        if (scores[index] < classThreshold) continue

        const label = _labels[classes[index]]
        
        
        if (!acceptedLabels.includes(label)) continue

        let [x1, y1, x2, y2] = boxes.slice(index * 4, (index + 1) * 4)
        x1 *= width
        x2 *= width
        y1 *= height
        y2 *= height

        const boxWidth = x2 - x1
        const boxHeight = y2 - y1
        const centerX = x1 + boxWidth / 2
        const centerY = y1 + boxHeight / 2

        const score = (scores[index] * 100).toFixed(2)
        

        yield {
            x: centerX,
            y: centerY,
            width: boxWidth,
            height: boxHeight,
            score,
            label,
        }

    }
}

loadModelAndLabels()

// Absolute timestamp, comparable with the main thread's (performance.now() alone has a per-thread origin)
const now = () => performance.timeOrigin + performance.now()

type WorkerMessage =
    | { type: 'config', classThreshold: number }
    | { type: 'predict', image: ImageBitmap, timing: { capturedAt: number, sentAt: number } }

self.onmessage = async ({ data }: { data: WorkerMessage }) => {
    if (data.type === 'config') {
        classThreshold = data.classThreshold
        return
    }
    if (!_model) return

    const startedAt = now()

    try {
        if (!_model) return

        const input = preprocessImage(data.image)
        const { width, height } = data.image

        const inferenceResults = await runInference(input)
        if (!inferenceResults) return
        const predictedAt = now()

        for (const prediction of processPrediction(inferenceResults, width, height)) {
            postMessage({
                type: 'prediction',
                ...prediction,
                timing: {
                    ...data.timing,
                    startedAt,
                    predictedAt,
                },
            });
        }
    } finally {
        data.image.close()
        postMessage({ type: 'inference-done' })
    }
};

console.log('🧠 YOLOv5n Web Worker initialized');
