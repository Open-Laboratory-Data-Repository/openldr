import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('app');
// App sets data-openldr-ready on <body> once its first load settles.
if (root) render(<App />, root);
