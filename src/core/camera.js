export const RESOLUTION_PRESETS = {
  full: { label: "Full", width: 1280, height: 720 },
  half: { label: "Half", width: 640, height: 360 },
  quarter: { label: "Quarter", width: 320, height: 180 },
};

export function getResolutionPreset(id) {
  return RESOLUTION_PRESETS[id] ?? RESOLUTION_PRESETS.full;
}

export async function startCamera(video, resolution) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();

  return stream;
}

export function stopCamera(stream, video) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  video.srcObject = null;
}
