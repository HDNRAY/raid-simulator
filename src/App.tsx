import { useEffect } from 'react';
import eventBus from 'util/eventBus';
import './App.css';
import Layout from './features/layout/Layout';
import { BrowserRouter } from 'react-router-dom'

function App() {
    useEffect(() => {
        const keyboardListener = (event: KeyboardEvent) => {
            eventBus.dispatch('inner-keydown', event.key);
        }

        window.addEventListener('keydown', keyboardListener);

        return () => {
            window.removeEventListener('keydown', keyboardListener);
        }
    }, [])
    return <BrowserRouter>
        <Layout></Layout>
    </BrowserRouter>
}

export default App;
