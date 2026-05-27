export function measureHandSignals(hands) {
  const signals = {
    "hand.count": hands.length,
  };

  hands.forEach((landmarks, index) => {
    const prefix = `hand.${index}`;
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];

    signals[`${prefix}.wrist.x`] = wrist.x;
    signals[`${prefix}.wrist.y`] = wrist.y;
    signals[`${prefix}.indexTip.x`] = indexTip.x;
    signals[`${prefix}.indexTip.y`] = indexTip.y;
    signals[`${prefix}.middleTip.x`] = middleTip.x;
    signals[`${prefix}.middleTip.y`] = middleTip.y;
    signals[`${prefix}.pinchDistance`] = distance(thumbTip, indexTip);
    signals[`${prefix}.spread`] = average(
      distance(thumbTip, pinkyTip),
      distance(indexTip, pinkyTip),
      distance(middleTip, pinkyTip),
      distance(ringTip, pinkyTip)
    );
  });

  return signals;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(...values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
