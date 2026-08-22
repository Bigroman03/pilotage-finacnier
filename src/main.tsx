import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SuiteShell from './SuiteShell';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><SuiteShell /></StrictMode>,
);
