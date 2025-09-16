import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

console.log('main.tsx: Starting application...');

const rootElement = document.getElementById("root");
console.log('main.tsx: Root element found:', !!rootElement);

if (!rootElement) {
  console.error('main.tsx: Root element not found!');
  document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Root element not found</div>';
} else {
  try {
    const root = createRoot(rootElement);
    console.log('main.tsx: Root created, rendering App...');
    root.render(<App />);
    console.log('main.tsx: App rendered successfully');
  } catch (error) {
    console.error('main.tsx: Error rendering app:', error);
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: ' + error.message + '</div>';
  }
}
