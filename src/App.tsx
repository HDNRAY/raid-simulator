import { useEffect } from 'react';
import eventBus from 'util/eventBus';
import './App.css';
import Layout from './features/layout/Layout';

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
    return <Layout></Layout>
}

export default App;
