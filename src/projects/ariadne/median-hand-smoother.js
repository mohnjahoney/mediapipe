export function createMedianHandSmoother({ windowSize = 5 } = {}) {
  const frames = [];

  return {
    reset() {
      frames.length = 0;
    },

    update(hands) {
      frames.push(cloneHands(hands));

      if (frames.length > windowSize) {
        frames.shift();
      }

      if (hands.length === 0) {
        frames.length = 0;
        return [];
      }

      return hands.map((landmarks, handIndex) =>
        landmarks.map((landmark, landmarkIndex) =>
          smoothLandmark(frames, handIndex, landmarkIndex, landmark)
        )
      );
    },
  };
}

function smoothLandmark(frames, handIndex, landmarkIndex, fallback) {
  return {
    ...fallback,
    x: medianCoordinate(frames, handIndex, landmarkIndex, "x", fallback.x),
    y: medianCoordinate(frames, handIndex, landmarkIndex, "y", fallback.y),
    z: medianCoordinate(frames, handIndex, landmarkIndex, "z", fallback.z ?? 0),
  };
}

function medianCoordinate(frames, handIndex, landmarkIndex, key, fallback) {
  const values = frames
    .map((frame) => frame[handIndex]?.[landmarkIndex]?.[key])
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return fallback;

  values.sort((a, b) => a - b);

  return values[Math.floor(values.length / 2)];
}

function cloneHands(hands) {
  return hands.map((landmarks) => landmarks.map((landmark) => ({ ...landmark })));
}
