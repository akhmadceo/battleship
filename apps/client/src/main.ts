import { Engine, Scene } from '@babylonjs/core';
import { Game } from './game';
import './style.css';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false }, true);
// Cap the pixel ratio: low-poly looks crisp enough at 2x, and phones stay fast.
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.skipPointerMovePicking = true;

const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 1e9);
const game = new Game(engine, scene, overlay, seed);

// Handy for automated tests and debugging in the browser console.
(window as unknown as { tidebound: Game }).tidebound = game;

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
