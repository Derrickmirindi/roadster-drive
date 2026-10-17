/**
 * Entry point: checks WebGL 2 support, shows loading progress and starts the app.
 */
import { App, showFatal } from './app.js';

const bar = document.getElementById('loader-bar') as HTMLElement;
const step = document.getElementById('loader-step') as HTMLElement;
const loader = document.getElementById('loader') as HTMLElement;

// Background tabs pause animation frames, so fall back to a timer to keep loading.
const nextFrame = () =>
  new Promise<void>((r) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });

function progress(pct: number, text: string): Promise<void> {
  bar.style.width = `${pct}%`;
  step.textContent = text;
  return nextFrame();
}

function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  await progress(10, 'Checking 3D graphics support…');
  const forceFail = new URLSearchParams(location.search).has('nowebgl');
  if (forceFail || !webgl2Available()) {
    showFatal(
      '3D graphics unavailable',
      'This browser or device could not start WebGL 2, which the driving view needs. Menus and credits remain available on this page.',
    );
    return;
  }
  await progress(30, 'Building the circuit and scenery…');
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  let app: App;
  try {
    app = new App(canvas);
  } catch (err) {
    console.error(err);
    showFatal('Could not start the 3D view', 'The graphics device refused to create a rendering context. Try enabling hardware acceleration or another browser.');
    return;
  }
  await progress(70, 'Preparing the roadster and controls…');
  app.init();
  await progress(90, 'Compiling materials…');
  try {
    app.renderer.compile(app.env.scene, app.rig.camera);
  } catch {
    /* compile is an optimisation; rendering will compile lazily */
  }
  await progress(100, 'Ready');
  loader.classList.add('is-done');
  loader.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => (loader.hidden = true), 350);
  (document.getElementById('btn-start') as HTMLElement).focus({ preventScroll: true });
}

boot().catch((err) => {
  console.error(err);
  showFatal('Something went wrong', 'The application failed to start. Reload the page to try again.');
});
