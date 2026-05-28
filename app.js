import { createFaceAudioInstrumentProject } from "./src/projects/face-audio-instrument/index.js";

const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");

const projects = {
  "face-audio-instrument": createFaceAudioInstrumentProject,
};

const projectId = location.hash.slice(1) || "face-audio-instrument";
const createProject = projects[projectId] ?? projects["face-audio-instrument"];
const project = createProject({ video, canvas });

project.start();
