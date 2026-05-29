import { createFaceAudioInstrumentProject } from "./src/projects/face-audio-instrument/index.js";
import { createAriadneProject } from "./src/projects/ariadne/index.js?v=2026-05-28-pinch-recognizer";
import { createDrawingProject } from "./src/projects/drawing/index.js?v=2026-05-28-drawing-calibration";
import { createWordBubblesProject } from "./src/projects/word-bubbles/index.js?v=2026-05-29-word-bubbles-volume-stretch";

const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const projectSelector = document.querySelector("#projectSelector");

const projects = {
  "face-audio-instrument": createFaceAudioInstrumentProject,
  ariadne: createAriadneProject,
  drawing: createDrawingProject,
  "word-bubbles": createWordBubblesProject,
};

const projectId = location.hash.slice(1) || "face-audio-instrument";
const createProject = projects[projectId] ?? projects["face-audio-instrument"];
projectSelector.value = projects[projectId] ? projectId : "face-audio-instrument";
projectSelector.addEventListener("change", () => {
  location.hash = projectSelector.value;
  location.reload();
});

const project = createProject({ video, canvas });

project.start();
