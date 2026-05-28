import { compileJointPair } from "./hand-joints.js";

export function createPinchRecognizer({
  from,
  to,
  baseThreshold = 0.06,
  enterScale = 1,
  exitScale = 1.25,
  minFrames = 2,
  sizeScale = defaultSizeScale,
} = {}) {
  const joints = compileJointPair({ from, to });
  let active = false;
  let candidateFrames = 0;
  let initialPoint = null;
  let lastPoint = null;
  let lastState = idleState();

  return {
    reset() {
      active = false;
      candidateFrames = 0;
      initialPoint = null;
      lastPoint = null;
      lastState = idleState();
    },

    update(hands) {
      const measurement = nearestMeasurement(hands, {
        baseThreshold,
        enterScale,
        exitScale,
        joints,
        sizeScale,
      });

      if (!measurement) {
        return setState(endOrIdle(null));
      }

      if (active) {
        if (measurement.distance <= measurement.exitThreshold) {
          lastPoint = measurement.point;
          return setState({
            ...baseState("changed", measurement),
            active: true,
            initialPoint,
            point: measurement.point,
          });
        }

        return setState(endOrIdle(measurement));
      }

      if (measurement.distance <= measurement.enterThreshold) {
        candidateFrames += 1;

        if (candidateFrames >= minFrames) {
          active = true;
          initialPoint = measurement.point;
          lastPoint = measurement.point;

          return setState({
            ...baseState("began", measurement),
            active: true,
            initialPoint,
            point: measurement.point,
          });
        }

        return setState({
          ...baseState("candidate", measurement),
          candidateFrames,
        });
      }

      candidateFrames = 0;
      return setState(baseState("idle", measurement));
    },

    get state() {
      return lastState;
    },
  };

  function endOrIdle(measurement) {
    if (!active) {
      candidateFrames = 0;
      return measurement ? baseState("idle", measurement) : idleState();
    }

    const finalPoint = lastPoint;
    const state = {
      ...baseState("ended", measurement),
      finalPoint,
      initialPoint,
    };

    active = false;
    candidateFrames = 0;
    initialPoint = null;
    lastPoint = null;

    return state;
  }

  function setState(state) {
    lastState = state;
    return state;
  }
}

function nearestMeasurement(hands, { baseThreshold, enterScale, exitScale, joints, sizeScale }) {
  let closest = null;
  let closestDistance = Infinity;

  hands.forEach((landmarks, handIndex) => {
    const fromPoint = landmarks[joints.fromIndex];
    const toPoint = landmarks[joints.toIndex];

    if (!fromPoint || !toPoint) return;

    const point = midpoint(fromPoint, toPoint);
    const scale = sizeScale(point, { hand: landmarks, handIndex });
    const enterThreshold = baseThreshold * enterScale * scale;
    const exitThreshold = enterThreshold * exitScale;
    const currentDistance = distance(fromPoint, toPoint);

    if (currentDistance < closestDistance) {
      closestDistance = currentDistance;
      closest = {
        distance: currentDistance,
        enterThreshold,
        exitThreshold,
        from: fromPoint,
        fromJoint: joints.from,
        handIndex,
        point,
        scale,
        to: toPoint,
        toJoint: joints.to,
      };
    }
  });

  return closest;
}

function baseState(phase, measurement) {
  return {
    active: false,
    candidateFrames: 0,
    distance: measurement?.distance ?? null,
    enterThreshold: measurement?.enterThreshold ?? null,
    exitThreshold: measurement?.exitThreshold ?? null,
    finalPoint: null,
    handIndex: measurement?.handIndex ?? null,
    initialPoint: null,
    measurement,
    phase,
    point: null,
  };
}

function idleState() {
  return baseState("idle", null);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

function defaultSizeScale() {
  return 1;
}
