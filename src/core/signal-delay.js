export function createSignalDelay(maxAgeMs = 2500) {
  let history = [];

  return {
    clear() {
      history = [];
    },

    push(sample, time = performance.now()) {
      history.push({ ...sample, time });
      history = history.filter((entry) => entry.time >= time - maxAgeMs);
    },

    get(delaySeconds, time = performance.now()) {
      if (history.length === 0) return null;

      const targetTime = time - delaySeconds * 1000;

      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].time <= targetTime) {
          return history[index];
        }
      }

      return history[0];
    },
  };
}
