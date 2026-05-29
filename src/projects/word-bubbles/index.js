import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createFaceTracker } from "../../media/face-tracker.js";

const MOUTH_CENTER_INDICES = [13, 14, 61, 291];
const FACE_CENTER_INDICES = [10, 152, 234, 454];
const MOUTH_OPEN_MIN = 0.055;
const BUBBLE_TRIGGER_INTERVAL_MS = 260;
const PENDING_WORD_TIMEOUT_MS = 2200;
const MAX_MOUTH_HOLD_BUBBLE_RADIUS = 126;
const MOUTH_HOLD_RADIUS_FACTOR = 60;
const MAX_BUBBLE_STRETCH = 1.95;
const STRETCH_SPRING = 24;
const STRETCH_DAMPING = 6.8;
const UNDERWATER_VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;
const UNDERWATER_FRAGMENT_SHADER = `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform float u_time;
  uniform vec2 u_resolution;
  varying vec2 v_uv;

  void main() {
    vec2 uv = v_uv;
    float slowTime = u_time * 0.42;
    float broadWave = sin(uv.y * 15.0 + slowTime * 1.7);
    float crossWave = sin((uv.x * 7.0 + uv.y * 5.0) - slowTime * 1.1);
    float shimmer = sin(uv.y * 34.0 - slowTime * 0.9) * 0.5 + 0.5;
    vec2 warp = vec2((broadWave + crossWave * 0.45) * 0.0055, sin(uv.x * 10.0 + slowTime) * 0.0025);
    vec4 color = texture2D(u_texture, clamp(uv + warp, 0.0, 1.0));

    color.rgb = (color.rgb - 0.5) * 1.18 + 0.5;
    color.rgb *= vec3(0.56, 0.82, 1.12);
    color.rgb *= 0.72 + shimmer * 0.06;
    color.rgb += vec3(0.0, 0.025, 0.045);

    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

export function createWordBubblesProject({ video, canvas }) {
  const stage = canvas.closest(".stage");
  const controls = document.querySelector(".controls");
  const loading = document.querySelector("#loading");
  const bubbleCanvas = document.createElement("canvas");
  const compositeCanvas = document.createElement("canvas");
  const bubbleCtx = compositeCanvas.getContext("2d");
  const underwaterRenderer = createUnderwaterRenderer(bubbleCanvas);
  const panel = createWordBubblesPanel(stage);

  let faceTracker;
  let stream;
  let animationFrameId = 0;
  let recognition = null;
  let micStream = null;
  let audioContext = null;
  let analyser = null;
  let audioSamples = null;
  let micLevel = 0;
  let isListening = false;
  let previousMouthOpen = 0;
  let lastBubbleTriggerTime = 0;
  let activeMouthBubble = null;
  let pendingSpeechBubble = null;
  let mouthOpenStartedAt = 0;
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
    drawCompositeVideo();

    const dt = Math.min(0.05, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    const volume = readMicLevel();

    const landmarks = faceTracker?.detect(video, time);
    if (landmarks) {
      lastFacePose = measureFacePose(landmarks);
      maybeTriggerBubble(lastFacePose, time, volume);
    }

    updateBubbles(dt, time);
    drawBubbles();
    underwaterRenderer.render(compositeCanvas, time / 1000);

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function maybeTriggerBubble(facePose, time, volume) {
    const isMouthOpen = facePose.mouthOpen > MOUTH_OPEN_MIN;
    const isOpening = isMouthOpen && previousMouthOpen <= MOUTH_OPEN_MIN;
    const isClosing = !isMouthOpen && previousMouthOpen > MOUTH_OPEN_MIN;
    const isAllowed = time - lastBubbleTriggerTime > BUBBLE_TRIGGER_INTERVAL_MS;
    previousMouthOpen = facePose.mouthOpen;

    if (isClosing) {
      detachActiveMouthBubble();
      activeMouthBubble = null;
      mouthOpenStartedAt = 0;
      return;
    }

    if (isMouthOpen && activeMouthBubble) {
      const holdSeconds = Math.max(0, (time - mouthOpenStartedAt) / 1000);
      const heldRadius = MOUTH_HOLD_RADIUS_FACTOR * Math.sqrt(holdSeconds);
      const holdInfluence = clamp(holdSeconds * 0.16, 0, 0.48);

      activeMouthBubble.x = facePose.mouth.x;
      activeMouthBubble.y = facePose.mouth.y;
      activeMouthBubble.direction = facePose.direction;
      activeMouthBubble.targetRadius = clamp(heldRadius, 8, MAX_MOUTH_HOLD_BUBBLE_RADIUS);
      activeMouthBubble.targetStretch = clamp(1 + volume * (0.62 + holdInfluence), 1, MAX_BUBBLE_STRETCH);
      return;
    }

    if (!isOpening || !isAllowed) return;

    activeMouthBubble = createBubble({ facePose, word: "" });
    pendingSpeechBubble = activeMouthBubble;
    mouthOpenStartedAt = time;
    bubbles.push(activeMouthBubble);
    lastBubbleTriggerTime = time;
  }

  function createBubble({ facePose, word }) {
    const direction = facePose?.direction ?? { x: 0, y: -1 };
    const horizontalDrift = Math.sign(direction.x || randomBetween(-1, 1)) * randomBetween(0.035, 0.065);
    const speed = randomBetween(0.055, 0.09);
    const sizeScale = randomBetween(0.78, 1.28);
    const textScale = randomBetween(0.72, 1.44);
    const wordRadius = word ? bubbleRadiusForWord(word, sizeScale) : 34 * sizeScale;
    const vx = direction.x * speed + horizontalDrift + randomBetween(-0.012, 0.012);
    const vy = direction.y * randomBetween(0.008, 0.018) - randomBetween(0.008, 0.018);

    return {
      age: 0,
      direction,
      id: randomId(),
      isAttached: !word,
      growthRate: randomBetween(1.6, 4.4),
      radius: word ? wordRadius * 0.6 : 8,
      sizeScale,
      stretch: 1,
      stretchVelocity: 0,
      targetStretch: 1,
      targetRadius: word ? wordRadius : 8,
      text: word,
      textScale,
      vx,
      vy,
      x: facePose?.mouth.x ?? 0.5,
      y: facePose?.mouth.y ?? 0.5,
    };
  }

  function detachActiveMouthBubble() {
    if (!activeMouthBubble) return;

    const direction = activeMouthBubble.direction ?? { x: 0, y: -1 };
    activeMouthBubble.isAttached = false;
    activeMouthBubble.targetStretch = 1;
    activeMouthBubble.vx = direction.x * randomBetween(0.055, 0.09) + Math.sign(direction.x || 1) * randomBetween(0.035, 0.065);
    activeMouthBubble.vy = direction.y * randomBetween(0.008, 0.018) - randomBetween(0.008, 0.018);
  }

  function updateBubbles(dt, time) {
    for (const bubble of bubbles) {
      bubble.age += dt;
      if (!bubble.isAttached) {
        bubble.x += bubble.vx * dt;
        bubble.y += bubble.vy * dt;
        bubble.targetRadius += bubble.growthRate * dt;
      }
      bubble.radius += (bubble.targetRadius - bubble.radius) * Math.min(1, dt * 4);
      updateBubbleStretch(bubble, dt);

      if (bubble !== activeMouthBubble && bubble !== pendingSpeechBubble && !bubble.text && bubble.age * 1000 > PENDING_WORD_TIMEOUT_MS) {
        bubble.targetRadius = Math.min(bubble.targetRadius, 16 * bubble.sizeScale);
      }
    }

    bubbles = bubbles.filter((bubble) => {
      const ageMs = bubble.age * 1000;
      const isOnscreen = bubble.x > -0.2 && bubble.x < 1.2 && bubble.y > -0.25 && bubble.y < 1.15;
      return (
        isOnscreen &&
        ageMs < 12000 &&
        !(bubble !== activeMouthBubble && bubble !== pendingSpeechBubble && ageMs > PENDING_WORD_TIMEOUT_MS && !bubble.text)
      );
    });
    if (activeMouthBubble && !bubbles.includes(activeMouthBubble)) {
      activeMouthBubble = null;
    }
    if (pendingSpeechBubble && !bubbles.includes(pendingSpeechBubble)) {
      pendingSpeechBubble = null;
    }

    panel.setBubbleCount(bubbles.length);
  }

  function drawBubbles() {
    for (const bubble of bubbles) {
      const x = (1 - bubble.x) * compositeCanvas.width;
      const y = bubble.y * compositeCanvas.height;
      const opacity = clamp(1 - Math.max(0, bubble.age - 9) / 3, 0, 1);

      bubbleCtx.save();
      bubbleCtx.globalAlpha = opacity;
      drawBubblePath(bubble, x, y, bubble.radius);
      bubbleCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
      bubbleCtx.fill();
      bubbleCtx.lineWidth = Math.max(2, bubble.radius * 0.055);
      bubbleCtx.strokeStyle = "rgba(86, 126, 180, 0.55)";
      bubbleCtx.stroke();
      drawBubbleHighlight(bubble, x, y);

      if (bubble.text) {
        drawBubbleText(bubble, x, y);
      }

      bubbleCtx.restore();
    }
  }

  function drawBubbleText(bubble, x, y) {
    const lines = hyphenatedLines(bubble.text);
    const fontSize = bubbleFontSize(bubble, lines);

    bubbleCtx.save();
    drawBubblePath(bubble, x, y, bubble.radius * 0.94);
    bubbleCtx.clip();
    bubbleCtx.fillStyle = "#15171d";
    bubbleCtx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    bubbleCtx.lineWidth = Math.max(2, fontSize * 0.08);
    bubbleCtx.shadowColor = "rgba(255, 255, 255, 0.35)";
    bubbleCtx.shadowBlur = bubble.radius * 0.12;
    bubbleCtx.font = `900 ${fontSize}px "Arial Rounded MT Bold", "Marker Felt", "Comic Sans MS", ui-rounded, system-ui, sans-serif`;
    bubbleCtx.textAlign = "center";
    bubbleCtx.textBaseline = "middle";

    const lineHeight = fontSize * 0.88;
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      const lineY = startY + index * lineHeight;
      const squeeze = 1 + Math.max(0, 34 - bubble.radius) / 120;

      bubbleCtx.save();
      bubbleCtx.translate(x, lineY);
      bubbleCtx.scale(squeeze, 1.08);
      bubbleCtx.strokeText(line, 0, 0);
      bubbleCtx.fillText(line, 0, 0);
      bubbleCtx.restore();
    });
    bubbleCtx.restore();
  }

  function drawBubblePath(bubble, x, y, radius) {
    const direction = canvasDirection(bubble.direction);
    const angle = Math.atan2(direction.y, direction.x);
    const stretch = clamp(bubble.stretch, 0.8, MAX_BUBBLE_STRETCH);
    const majorRadius = radius * stretch;
    const minorRadius = radius / Math.sqrt(stretch);

    bubbleCtx.beginPath();
    bubbleCtx.ellipse(x, y, majorRadius, minorRadius, angle, 0, Math.PI * 2);
  }

  function drawBubbleHighlight(bubble, x, y) {
    const direction = canvasDirection(bubble.direction);
    const angle = Math.atan2(direction.y, direction.x);
    const stretch = clamp(bubble.stretch, 0.8, MAX_BUBBLE_STRETCH);
    const majorRadius = bubble.radius * stretch;
    const minorRadius = bubble.radius / Math.sqrt(stretch);
    const highlight = rotatePoint(-majorRadius * 0.26, -minorRadius * 0.34, angle);
    const spot = rotatePoint(-majorRadius * 0.08, -minorRadius * 0.1, angle);

    bubbleCtx.save();
    bubbleCtx.translate(x + highlight.x, y + highlight.y);
    bubbleCtx.rotate(angle - 0.35);
    bubbleCtx.beginPath();
    bubbleCtx.ellipse(0, 0, Math.max(5, majorRadius * 0.16), Math.max(2, minorRadius * 0.045), 0, 0, Math.PI * 2);
    bubbleCtx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    bubbleCtx.lineWidth = Math.max(2, bubble.radius * 0.035);
    bubbleCtx.lineCap = "round";
    bubbleCtx.stroke();
    bubbleCtx.restore();

    bubbleCtx.save();
    bubbleCtx.translate(x + spot.x, y + spot.y);
    bubbleCtx.rotate(angle);
    bubbleCtx.beginPath();
    bubbleCtx.ellipse(0, 0, Math.max(2.5, majorRadius * 0.055), Math.max(2, minorRadius * 0.04), 0, 0, Math.PI * 2);
    bubbleCtx.fillStyle = "rgba(255, 255, 255, 0.62)";
    bubbleCtx.fill();
    bubbleCtx.restore();
  }

  function updateBubbleStretch(bubble, dt) {
    const displacement = bubble.targetStretch - bubble.stretch;
    const acceleration = displacement * STRETCH_SPRING - bubble.stretchVelocity * STRETCH_DAMPING;

    bubble.stretchVelocity += acceleration * dt;
    bubble.stretch += bubble.stretchVelocity * dt;
    bubble.stretch = clamp(bubble.stretch, 0.8, MAX_BUBBLE_STRETCH);
  }

  async function startListening() {
    if (!recognition) {
      panel.setStatus("Speech recognition is not available in this browser.");
      return;
    }

    try {
      try {
        await startMicrophoneLevel();
      } catch {
        panel.setStatus("Listening without volume shape.");
      }

      recognition.start();
    } catch (error) {
      panel.setStatus(error.message || "Could not start listening.");
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
    stopMicrophoneLevel();
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
      stopMicrophoneLevel();
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

    const bubble = bubbleCanReceiveWord(pendingSpeechBubble)
      ? pendingSpeechBubble
      : bubbles.find((candidate) => bubbleCanReceiveWord(candidate));
    const target = bubble ?? createBubble({ facePose: lastFacePose, word });

    target.text = word;
    target.targetRadius = Math.max(target.targetRadius, bubbleRadiusForWord(word, target.sizeScale));
    target.radius = Math.max(target.radius, 18);

    if (target === activeMouthBubble) {
      detachActiveMouthBubble();
      activeMouthBubble = null;
      mouthOpenStartedAt = 0;
    }
    if (target === pendingSpeechBubble) {
      pendingSpeechBubble = null;
    }

    if (!bubble) {
      bubbles.push(target);
    }
  }

  function bubbleCanReceiveWord(bubble) {
    return Boolean(bubble && !bubble.text && bubbles.includes(bubble));
  }

  async function startMicrophoneLevel() {
    if (analyser) return;

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("Audio analysis is not available in this browser.");
    }

    audioContext = new AudioContextConstructor();
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioSamples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
  }

  function stopMicrophoneLevel() {
    micStream?.getTracks().forEach((track) => track.stop());
    micStream = null;
    analyser = null;
    audioSamples = null;
    micLevel = 0;
    audioContext?.close();
    audioContext = null;
  }

  function readMicLevel() {
    if (!analyser || !audioSamples) return micLevel;

    analyser.getByteTimeDomainData(audioSamples);

    let sumSquares = 0;
    for (const sample of audioSamples) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }

    const rms = Math.sqrt(sumSquares / audioSamples.length);
    const level = clamp((rms - 0.015) / 0.12, 0, 1);
    micLevel += (level - micLevel) * 0.28;

    return micLevel;
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

    if (compositeCanvas.width !== width || compositeCanvas.height !== height) {
      compositeCanvas.width = width;
      compositeCanvas.height = height;
    }

    underwaterRenderer.resize();
  }

  function drawCompositeVideo() {
    bubbleCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);

    if (!video.videoWidth || !video.videoHeight) return;

    bubbleCtx.save();
    bubbleCtx.translate(compositeCanvas.width, 0);
    bubbleCtx.scale(-1, 1);
    bubbleCtx.drawImage(video, 0, 0, compositeCanvas.width, compositeCanvas.height);
    bubbleCtx.restore();
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

function createUnderwaterRenderer(canvas) {
  const gl = canvas.getContext("webgl", { alpha: false }) ?? canvas.getContext("experimental-webgl", { alpha: false });

  if (!gl) {
    const ctx = canvas.getContext("2d");

    return {
      render(source) {
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      },
      resize() {},
    };
  }

  const program = createProgram(gl, UNDERWATER_VERTEX_SHADER, UNDERWATER_FRAGMENT_SHADER);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const textureLocation = gl.getUniformLocation(program, "u_texture");
  const timeLocation = gl.getUniformLocation(program, "u_time");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  return {
    render(source, time) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1i(textureLocation, 0);
      gl.uniform1f(timeLocation, time);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    resize() {
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
  };
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Could not link underwater shader.");
  }

  return program;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile underwater shader.");
  }

  return shader;
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
    x: (mouth.x - faceCenter.x) * 8,
    y: -0.32 + (mouth.y - faceCenter.y) * 0.8,
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

function bubbleFontSize(bubble, lines) {
  const longestLineLength = Math.max(...lines.map((line) => line.length));
  const singleLineScale = longestLineLength <= 4 ? 0.92 : 0.76;
  const multiLineScale = longestLineLength <= 5 ? 0.62 : 0.54;
  const baseScale = lines.length === 1 ? singleLineScale : multiLineScale;

  return clamp(bubble.radius * baseScale * bubble.textScale, 14, bubble.radius * 1.35);
}

function countSyllables(word) {
  const matches = word.toLowerCase().match(/[aeiouy]+/g);
  return matches?.length ?? 1;
}

function bubbleRadiusForWord(word, sizeScale = 1) {
  return clamp((24 + word.length * 3.4) * sizeScale, 30, 90);
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

function canvasDirection(direction = { x: 0, y: -1 }) {
  return normalizeVector({
    x: -direction.x,
    y: direction.y,
  });
}

function rotatePoint(x, y, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
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
