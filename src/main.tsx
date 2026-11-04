import './window-experience.css';
import {StrictMode,Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './fonts.css';
import './theme.css';
const Screen=lazy(new URLSearchParams(location.search).get('view')==='task-strip'?()=>import('./tasks/TaskStrip'):()=>import('./NotebookRoot'));
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={null}><Screen/></Suspense></StrictMode>);
