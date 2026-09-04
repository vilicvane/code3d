import {StrictMode} from 'react';
import {createRoot, hydrateRoot} from 'react-dom/client';
import {App} from './app.js';
import type {HighlightedCodeSamples} from './code-samples.js';
import './style.css';

const root = document.querySelector('#root');

if (!(root instanceof HTMLElement)) {
  throw new Error('The Code3D website root is missing.');
}

const samplesElement = document.querySelector('#code3d-code-samples');
const samples = samplesElement?.textContent
  ? (JSON.parse(samplesElement.textContent) as HighlightedCodeSamples)
  : undefined;

const application = (
  <StrictMode>
    <App samples={samples} />
  </StrictMode>
);

if (root.hasChildNodes()) {
  hydrateRoot(root, application);
} else {
  createRoot(root).render(application);
}
