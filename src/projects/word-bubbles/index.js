import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createFaceTracker } from "../../media/face-tracker.js";

const MOUTH_CENTER_INDICES = [13, 14, 61, 291];
const FACE_CENTER_INDICES = [10, 152, 234, 454];
const MOUTH_OPEN_MIN = 0.055;
const BUBBLE_TRIGGER_INTERVAL_MS = 260;
const PENDING_WORD_TIMEOUT_MS = 2200;

export function createWordBubblesProject({ video, canvas }) {
  const stage = canvas.closest(".stage");
  const controls = document.querySelector(".controls");
  const loading = document.querySelector("#loading");
  const bubbleCanvas = document.createElement("canvas");
  const bubbleCtx = bubbleCanvas.getContext("2d");
  const panel = createWordBubblesPanel(stage);

  let faceTracker;
  let stream;
  let animationFrameId = 0;
  let recognition = null;
  let isListening = false;
  let previousMouthOpen = 0;
  let lastBubbleTriggerTime = 0;
  let lastFacePose = null;
  let lastFrameTime = performance.now();
  let bubbles = [];

  bubbleCanvas.className = "word-bubble-canvas";
  stage.append(bubbleCanvas);

  return {
    async start() {
      document.body.classList.add("project-word-bubbles");
      controls.hidden = true;
      panel.element.hidden = false;
      panel.startButton.addEventListener("click", startListening);
      panel.stopButton.addEventListener("click", stopListening);
      loading.textContent = "Loading Word Bubbles...";

      try {
        faceTracker = await createFaceTracker();
        stream = await startCamera(video, getResolutionPreset("full"));
        recognition = createSpeechRecognition();
        panel.setStatus(recognition ? "Tap Start Listening." : "Speech recognition unavailable.");
        updateSpeechControls();
        loading.hidden = true;
        runFrame();
      } catch (error) {
        loading.textContent = error.message;
      }
    },

    stop() {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
      stopListening();
      faceTracker = null;
      stopCamera(stream, video);
      stream = null;
      panel.startButton.removeEventListener("click", startListening);
      panel.stopButton.removeEventListener("click", stopListening);
      panel.element.remove();
      bubbleCanvas.remove();
      controls.hidden = false;
      document.body.classList.remove("project-word-bubbles");
    },
  };

  function runFrame(time = performance.now()) {
    resizeBubbleCanvas();
    bubbleCtx.clearRect(0, 0, bubbleCanvas.width, bubbleCanvas.height);

    const dt = Math.min(0.05, (time - lastFrameTime) / 1000);
    lastFrameTime = time;

    const landmarks = faceTracker?.detect(video, time);
    if (landmarks) {
      lastFacePose = measureFacePose(landmarks);
      maybeTriggerBubble(lastFacePose, time);
    }

    updateBubbles(dt, time);
    drawBubbles();

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function maybeTriggerBubble(facePose, time) {
    const isOpening = facePose.mouthOpen > MOUTH_OPEN_MIN && previousMouthOpen <= MOUTH_OPEN_MIN;
    const isAllowed = time - lastBubbleTriggerTime > BUBBLE_TRIGGER_INTERVAL_MS;
    previousMouthOpen = facePose.mouthOpen;

    if (!isOpening || !isAllowed) return;

    bubbles.push(createBubble({ facePose, word: "" }));
    lastBubbleTriggerTime = time;
  }

  function createBubble({ facePose, word }) {
    const direction = facePose?.direction ?? { x: 0, y: -1 };
    const speed = randomBetween(0.025, 0.045);

    return {
      age: 0,
      direction,
      id: randomId(),
      radius: word ? bubbleRadiusForWord(word) : 8,
      targetRadius: word ? bubbleRadiusForWord(word) : 34,
      text: word,
      vx: direction.x * speed + randomBetween(-0.01, 0.01),
      vy: direction.y * speed - randomBetween(0.01, 0.025),
      x: facePose?.mouth.x ?? 0.5,
      y: facePose?.mouth.y ?? 0.5,
    };
  }

  function updateBubbles(dt, time) {
    for (const bubble of bubbles) {
      bubble.age += dt;
      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;
      bubble.radius += (bubble.targetRadius - bubble.radius) * Math.min(1, dt * 4);

      if (!bubble.text && bubble.age * 1000 > PENDING_WORD_TIMEOUT_MS) {
        bubble.targetRadius = 16;
      }
    }

    bubbles = bubbles.filter((bubble) => {
      const ageMs = bubble.age * 1000;
      const isOnscreen = bubble.x > -0.2 && bubble.x < 1.2 && bubble.y > -0.25 && bubble.y < 1.15;
      return isOnscreen && ageMs < 12000 && !(ageMs > PENDING_WORD_TIMEOUT_MS && !bubble.text);
    });

    panel.setBubbleCount(bubbles.length);
  }

  function drawBubbles() {
    for (const bubble of bubbles) {
      const x = (1 - bubble.x) * bubbleCanvas.width;
      const y = bubble.y * bubbleCanvas.height;
      const opacity = clamp(1 - Math.max(0, bubble.age - 9) / 3, 0, 1);

      bubbleCtx.save();
      bubbleCtx.globalAlpha = opacity;
      bubbleCtx.beginPath();
      bubbleCtx.arc(x, y, bubble.radius, 0, Math.PI * 2);
      bubbleCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
      bubbleCtx.fill();
      bubbleCtx.lineWidth = 2;
      bubbleCtx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      bubbleCtx.stroke();

      if (bubble.text) {
        drawBubbleText(bubble, x, y);
      }

      bubbleCtx.restore();
    }
  }

  function drawBubbleText(bubble, x, y) {
    const lines = hyphenatedLines(bubble.text);
    const fontSize = Math.max(12, Math.min(22, bubble.radius * 0.34));

    bubbleCtx.fillStyle = "#15171d";
    bubbleCtx.font = `700 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
    bubbleCtx.textAlign = "center";
    bubbleCtx.textBaseline = "middle";

    const lineHeight = fontSize * 1.05;
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      bubbleCtx.fillText(line, x, startY + index * lineHeight);
    });
  }

  function startListening() {
    if (!recognition) {
      panel.setStatus("Speech recognition is not available in this browser.");
      return;
    }

    try {
      recognition.start();
    } catch {
      // Some browsers throw if recognition is already starting.
    }
  }

  function stopListening() {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Some browsers throw if recognition is already stopped.
    }
  }

  function createSpeechRecognition() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      panel.setStatus("Speech recognition unavailable.");
      return null;
    }

    const speech = new Recognition();
    speech.continuous = true;
    speech.interimResults = true;
    speech.lang = "en-US";

    let emittedWordCount = 0;

    speech.addEventListener("start", () => {
      isListening = true;
      emittedWordCount = 0;
      panel.setStatus("Listening...");
      updateSpeechControls();
    });

    speech.addEventListener("end", () => {
      isListening = false;
      panel.setStatus("Not listening.");
      updateSpeechControls();
    });

    speech.addEventListener("error", (event) => {
      panel.setStatus(`Speech error: ${event.error}`);
      updateSpeechControls();
    });

    speech.addEventListener("result", (event) => {
      const words = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const newWords = words.slice(emittedWordCount);

      for (const word of newWords) {
        assignWordToBubble(cleanWord(word));
      }

      emittedWordCount += newWords.length;
    });

    return speech;
  }

  function assignWordToBubble(word) {
    if (!word) return;

    const bubble = bubbles.find((candidate) => !candidate.text);
    const target = bubble ?? createBubble({ facePose: lastFacePose, word });

    target.text = word;
    target.targetRadius = bubbleRadiusForWord(word);
    target.radius = Math.max(target.radius, 18);

    if (!bubble) {
      bubbles.push(target);
    }
  }

  function updateSpeechControls() {
    panel.startButton.disabled = !recognition || isListening;
    panel.stopButton.disabled = !recognition || !isListening;
  }

  function resizeBubbleCanvas() {
    const width = video.videoWidth || bubbleCanvas.clientWidth;
    const height = video.videoHeight || bubbleCanvas.clientHeight;

    if (bubbleCanvas.width !== width || bubbleCanvas.height !== height) {
      bubbleCanvas.width = width;
      bubbleCanvas.height = height;
    }
  }
}

function createWordBubblesPanel(stage) {
  const element = document.createElement("div");
  const startButton = document.createElement("button");
  const stopButton = document.createElement("button");
  const status = document.createElement("span");
  const count = document.createElement("span");

  element.className = "word-bubbles-control";
  element.hidden = true;
  startButton.type = "button";
  startButton.textContent = "Start Listening";
  stopButton.type = "button";
  stopButton.textContent = "Stop";
  status.textContent = "Camera loading.";
  count.textContent = "Bubbles 0";
  element.append(startButton, stopButton, status, count);
  stage.append(element);

  return {
    count,
    element,
    startButton,
    stopButton,
    setBubbleCount(value) {
      count.textContent = `Bubbles ${value}`;
    },
    setStatus(message) {
      status.textContent = message;
    },
  };
}

function measureFacePose(landmarks) {
  const mouth = averagePoints(MOUTH_CENTER_INDICES.map((index) => landmarks[index]));
  const faceCenter = averagePoints(FACE_CENTER_INDICES.map((index) => landmarks[index]));
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const mouthWidth = distance(leftMouth, rightMouth);
  const mouthOpen = distance(upperLip, lowerLip) / Math.max(0.001, mouthWidth);
  const rawDirection = normalizeVector({
    x: (mouth.x - faceCenter.x) * 4,
    y: -0.8 + (mouth.y - faceCenter.y) * 1.2,
  });

  return {
    direction: rawDirection,
    mouth,
    mouthOpen,
  };
}

function cleanWord(word) {
  return word.toLowerCase().replace(/(^[^a-z0-9]+|[^a-z0-9]+$)/gi, "");
}

function hyphenatedLines(word) {
  if (countSyllables(word) <= 2 || word.length < 9) return [word];

  const splitAt = Math.max(3, Math.min(word.length - 3, Math.round(word.length / 2)));
  return [`${word.slice(0, splitAt)}-`, word.slice(splitAt)];
}

function countSyllables(word) {
  const matches = word.toLowerCase().match(/[aeiouy]+/g);
  return matches?.length ?? 1;
}

function bubbleRadiusForWord(word) {
  return clamp(28 + word.length * 3.2, 38, 76);
}

function averagePoints(points) {
  const validPoints = points.filter(Boolean);
  if (validPoints.length === 0) return { x: 0.5, y: 0.5 };

  const total = validPoints.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / validPoints.length,
    y: total.y / validPoints.length,
  };
}

function distance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) return { x: 0, y: -1 };

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
